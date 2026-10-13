#!/usr/bin/env python3
"""Train and export the portable competitor-discovery ranker.

The input vectors are emitted by the same TypeScript aggregate extractor used
by Cloud and self-hosted inference. Ranker-train consumes out-of-fold entity
role scores; validation selects the threshold and test is evaluated once.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import re
from pathlib import Path
from typing import Any

import numpy as np
import sklearn
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score, roc_auc_score


FEATURE_ORDER = [
    "context_similarity", "primary_context_similarity", "seed_proximity", "structure_similarity", "list_table_role",
    "comparison_language", "repeated_mention", "name_quality", "direct_domain",
    "source_only", "heading_only", "generic_entity", "publisher_citation",
    "answer_support", "distinct_link_domains_per_surface", "link_label_only",
    "mwis_primary_fraction",
    "entity_role",
]


def validate_entity_role_transform(value: Any) -> dict[str, Any]:
    expected_keys = {
        "schemaVersion", "name", "source", "percentileMethod",
        "lowerPercentile", "upperPercentile", "roundingDecimals", "zLo", "zHi",
        "formula", "selectedRows", "inputSha256",
    }
    if (
        not isinstance(value, dict)
        or set(value) != expected_keys
        or value.get("schemaVersion") != 1
        or value.get("name") != "clipped-affine-logit-percentile"
        or value.get("source") != "oof-train"
        or value.get("percentileMethod") != "numpy.percentile(method=linear)"
        or value.get("lowerPercentile") != 1
        or value.get("upperPercentile") != 99
        or value.get("roundingDecimals") != 6
        or value.get("formula") != "clip((z-zLo)/(zHi-zLo),0,1)"
        or type(value.get("selectedRows")) is not int
        or value["selectedRows"] < 1
        or not isinstance(value.get("inputSha256"), str)
        or re.fullmatch(r"[a-f0-9]{64}", value["inputSha256"]) is None
    ):
        raise ValueError("invalid ranker entity-role transform")
    z_lo = value.get("zLo")
    z_hi = value.get("zHi")
    if (
        isinstance(z_lo, bool)
        or isinstance(z_hi, bool)
        or not isinstance(z_lo, (int, float))
        or not isinstance(z_hi, (int, float))
        or not np.isfinite(z_lo)
        or not np.isfinite(z_hi)
        or z_hi <= z_lo
    ):
        raise ValueError("invalid ranker entity-role transform bounds")
    return value


def load_vectors(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    artifact = json.loads(path.read_text(encoding="utf-8"))
    if artifact.get("schemaVersion") != 6:
        raise ValueError("unsupported training-vector schema")
    if artifact.get("testEvaluationCount") != 0:
        raise ValueError("sealed ranker test was already evaluated")
    if artifact.get("featureOrder") != FEATURE_ORDER:
        raise ValueError("training-vector feature schema does not match trainer")
    validate_entity_role_transform(artifact.get("entityRoleTransform"))
    rows = artifact.get("rows")
    if not isinstance(rows, list) or not rows:
        raise ValueError("training vectors contain no rows")
    seen_ids: set[str] = set()
    for row in rows:
        if row.get("id") in seen_ids:
            raise ValueError(f"duplicate training row: {row.get('id')}")
        seen_ids.add(row.get("id"))
        if row.get("partition") not in {"train", "validation", "test"}:
            raise ValueError(f"invalid partition for {row.get('id')}")
        expected_labels = {"sealed"} if row.get("partition") == "test" else {0, 1}
        if row.get("label") not in expected_labels:
            raise ValueError(f"invalid label for {row.get('id')}")
        features = row.get("features")
        if (
            not isinstance(features, dict)
            or len(features) != len(FEATURE_ORDER)
            or set(features) != set(FEATURE_ORDER)
        ):
            raise ValueError(f"feature drift for {row.get('id')}")
        candidate_feed = row.get("candidateFeed")
        if not isinstance(candidate_feed, list) or not candidate_feed:
            raise ValueError(f"empty candidate feed for {row.get('id')}")
        origins = [span.get("selectionOrigin") for span in candidate_feed if isinstance(span, dict)]
        if len(origins) != len(candidate_feed) or any(
            origin not in {"mwis-primary", "zone-recovery"} for origin in origins
        ):
            raise ValueError(f"invalid candidate feed origin for {row.get('id')}")
        expected_primary_fraction = origins.count("mwis-primary") / len(origins)
        if not np.isclose(
            features.get("mwis_primary_fraction"),
            expected_primary_fraction,
            rtol=0,
            atol=1e-12,
        ):
            raise ValueError(f"candidate feed fraction drift for {row.get('id')}")
        values = np.asarray([features[name] for name in FEATURE_ORDER], dtype=float)
        if not np.isfinite(values).all() or (values < 0).any() or (values > 1).any():
            raise ValueError(f"invalid feature value for {row.get('id')}")
    return artifact, rows


def partition_matrix(rows: list[dict[str, Any]], partition: str, feature_indices: list[int] | None = None, feature_key: str = "features") -> tuple[np.ndarray, np.ndarray, list[dict[str, Any]]]:
    selected = [row for row in rows if row["partition"] == partition]
    indices = feature_indices if feature_indices is not None else list(range(len(FEATURE_ORDER)))
    matrix = np.asarray([[row[feature_key][FEATURE_ORDER[index]] for index in indices] for row in selected], dtype=float)
    labels = np.asarray([row["label"] for row in selected], dtype=int)
    if len(set(labels.tolist())) != 2:
        raise ValueError(f"{partition} partition must contain both labels")
    return matrix, labels, selected


def select_threshold(labels: np.ndarray, probabilities: np.ndarray) -> float:
    unique = sorted(set(float(value) for value in probabilities))
    candidates = [0.0, 1.0, *unique, *((left + right) / 2 for left, right in zip(unique, unique[1:]))]
    ranked: list[tuple[float, float, float, float]] = []
    for threshold in candidates:
        predicted = probabilities >= threshold
        ranked.append((
            float(f1_score(labels, predicted, zero_division=0)),
            float(precision_score(labels, predicted, zero_division=0)),
            float(recall_score(labels, predicted, zero_division=0)),
            float(threshold),
        ))
    best = max((f1, precision, recall) for f1, precision, recall, _ in ranked)
    plateau = [threshold for f1, precision, recall, threshold in ranked if (f1, precision, recall) == best]
    # The validation predictions are identical across this plateau. Freeze its
    # lower edge so the aggregate stage abstains no more than validation
    # requires; this is deterministic and uses no test or named-regression
    # outcome.
    return round(float(min(plateau)), 12)


def metrics(labels: np.ndarray, probabilities: np.ndarray, threshold: float) -> dict[str, Any]:
    predicted = probabilities >= threshold
    result: dict[str, Any] = {
        "rows": int(len(labels)), "positives": int(labels.sum()),
        "accuracy": round(float(accuracy_score(labels, predicted)), 6),
        "precision": round(float(precision_score(labels, predicted, zero_division=0)), 6),
        "recall": round(float(recall_score(labels, predicted, zero_division=0)), 6),
        "f1": round(float(f1_score(labels, predicted, zero_division=0)), 6),
    }
    if len(set(labels.tolist())) == 2:
        result["rocAuc"] = round(float(roc_auc_score(labels, probabilities)), 6)
    return result


def slice_metrics(rows: list[dict[str, Any]], labels: np.ndarray, probabilities: np.ndarray, threshold: float) -> dict[str, Any]:
    selectors = {
        "en": lambda row: row.get("locale") == "en",
        "pt-BR": lambda row: row.get("locale") == "pt-BR",
        "oneToken": lambda row: len(row["candidate"].split()) == 1,
        "prose": lambda row: row["features"]["list_table_role"] == 0 and row["features"]["heading_only"] == 0,
        "structured": lambda row: row["features"]["list_table_role"] == 1 or row["features"]["heading_only"] == 1,
        "publisher": lambda row: row["features"]["publisher_citation"] > 0,
        "generic": lambda row: row["features"]["generic_entity"] >= 0.5,
    }
    result: dict[str, Any] = {}
    for name, selector in selectors.items():
        indices = [index for index, row in enumerate(rows) if selector(row)]
        if indices:
            result[name] = metrics(labels[indices], probabilities[indices], threshold)
    return result


def fit_model(matrix: np.ndarray, labels: np.ndarray) -> LogisticRegression:
    model = LogisticRegression(C=0.8, class_weight="balanced", max_iter=2000, solver="liblinear", random_state=37)
    model.fit(matrix, labels)
    return model


def train(vectors_path: Path, output: Path) -> dict[str, Any]:
    vectors, rows = load_vectors(vectors_path)
    train_matrix, train_labels, train_rows = partition_matrix(rows, "train")
    validation_matrix, validation_labels, validation_rows = partition_matrix(rows, "validation")
    model = fit_model(train_matrix, train_labels)
    validation_probabilities = model.predict_proba(validation_matrix)[:, 1]
    threshold = select_threshold(validation_labels, validation_probabilities)
    source_only_probabilities = [
        float(probability)
        for row, probability in zip(validation_rows, validation_probabilities, strict=True)
        if row["features"]["source_only"] == 1
    ]

    ablated_indices = [
        index
        for index, name in enumerate(FEATURE_ORDER)
        if name != "primary_context_similarity"
    ]
    ablated_train_matrix, ablated_train_labels, ablated_train_rows = partition_matrix(
        rows, "train", feature_indices=ablated_indices
    )
    ablated_validation_matrix, ablated_validation_labels, ablated_validation_rows = partition_matrix(
        rows, "validation", feature_indices=ablated_indices
    )
    if (
        [row["id"] for row in ablated_train_rows] != [row["id"] for row in train_rows]
        or [row["id"] for row in ablated_validation_rows]
        != [row["id"] for row in validation_rows]
        or not np.array_equal(ablated_train_labels, train_labels)
        or not np.array_equal(ablated_validation_labels, validation_labels)
    ):
        raise ValueError("primary-context ablation rows or labels drifted")
    ablated_model = fit_model(ablated_train_matrix, ablated_train_labels)
    ablated_validation = ablated_model.predict_proba(ablated_validation_matrix)[:, 1]
    ablated_threshold = select_threshold(validation_labels, ablated_validation)

    parity_rows = [
        validation_rows[0],
        validation_rows[len(validation_rows) // 2],
        validation_rows[-1],
    ]
    parity_vectors = []
    for row in parity_rows:
        vector = np.asarray([[row["features"][name] for name in FEATURE_ORDER]], dtype=float)
        parity_vectors.append({
            "id": row["id"], "features": row["features"],
            "candidateFeed": row["candidateFeed"],
            "score": round(float(model.predict_proba(vector)[0, 1]), 12),
        })
    schema_contract_features = dict(parity_rows[0]["features"])
    schema_contract_features["source_only"] = 0.0
    schema_contract_features["publisher_citation"] = 0.5
    schema_contract_vector = np.asarray(
        [[schema_contract_features[name] for name in FEATURE_ORDER]], dtype=float
    )
    schema_contract_parity_vectors = [{
        "id": "schema-contract:mixed-publisher-citation",
        "features": schema_contract_features,
        "score": round(float(model.predict_proba(schema_contract_vector)[0, 1]), 12),
    }]

    artifact = {
        "schemaVersion": 6,
        "modelType": "sklearn.linear_model.LogisticRegression",
        "classOrder": [0, 1],
        "scoreMeaning": "Ranking score from an uncalibrated logistic model; do not present as probability.",
        "featureOrder": FEATURE_ORDER,
        "intercept": round(float(model.intercept_[0]), 12),
        "coefficients": [round(float(value), 12) for value in model.coef_[0]],
        "decisionThreshold": threshold,
        "provenance": {
            "datasetVersion": vectors["datasetVersion"],
            "trainingScript": "packages/core/scripts/train-competitor-discovery.py",
            "featureGenerator": vectors["generatedBy"],
            "sourceCorpus": vectors["sourceCorpus"],
            "trainingVectors": "packages/core/scripts/competitor-discovery-training-vectors.json",
            "trainingVectorsSha256": hashlib.sha256(vectors_path.read_bytes()).hexdigest(),
            "sourceCorpusSha256": vectors["corpusSha256"],
            "featureSource": vectors["featureSource"],
            "featureSourceSha256": vectors["featureSourceSha256"],
            "identityImplementation": vectors["identityImplementation"],
            "identityImplementationSha256": vectors["identityImplementationSha256"],
            "primitiveImplementation": vectors["primitiveImplementation"],
            "primitiveImplementationSha256": vectors["primitiveImplementationSha256"],
            "candidateFeedPolicy": vectors["candidateFeedPolicy"],
            "candidateFeedAudit": vectors["candidateFeedAudit"],
            "primitiveVectorsSha256": vectors["primitiveVectorsSha256"],
            "entityRoleScoresSha256": vectors["entityRoleScoresSha256"],
            "entityRoleModelParametersSha256": vectors["entityRoleModelParametersSha256"],
            "entityRoleTransform": validate_entity_role_transform(
                vectors["entityRoleTransform"]
            ),
            "testSealSha256": vectors["testSealSha256"],
            "testEvaluationCount": 0,
            "testEvaluationScope": "active-ranker-formal-sealed-evaluation",
            "splitPolicy": "Same connected-component partitions as the entity-role primitive corpus; train entity_role values are out-of-fold and validation/test use the final train-only span model.",
            "datasetRows": len(rows),
            "fitPositiveRows": int(sum(row["label"] for row in rows if row["partition"] != "test")),
            "fitNegativeRows": int(sum(row["label"] == 0 for row in rows if row["partition"] != "test")),
            "customerDataUsed": False, "humanAnnotationUsed": False, "randomState": 37,
            "fitAccounting": {
                "selectedCandidateFits": 1,
                "diagnosticAblationFits": 1,
                "computationalFits": 2,
                "matchedRowsWeightsRandomStateAndThresholdPolicy": True,
            },
            "pythonVersion": platform.python_version(), "scikitLearnVersion": sklearn.__version__,
        },
        "metrics": {
            "evaluation": "Train/validation fit only; sealed test labels were not evaluated in this phase.",
            "thresholdSelection": metrics(validation_labels, validation_probabilities, threshold),
            "thresholdSelectionPolicy": "Validation F1, precision, recall; lower edge of an identical-prediction plateau.",
            "slices": {
                "train": slice_metrics(
                    train_rows,
                    train_labels,
                    model.predict_proba(train_matrix)[:, 1],
                    threshold,
                ),
                "validation": slice_metrics(
                    validation_rows,
                    validation_labels,
                    validation_probabilities,
                    threshold,
                ),
            },
            "signalAblation": {
                "representation": vectors["signalAblation"],
                "matchedRowsWeightsRandomStateAndThresholdPolicy": True,
                "validation": metrics(validation_labels, ablated_validation, ablated_threshold),
                "decisionThreshold": ablated_threshold,
            },
            "maxSourceOnlyScore": round(max(source_only_probabilities), 12)
            if source_only_probabilities
            else 0.0,
            "maxSourceOnlyScoreScope": "validation",
            "limitation": "The corpus is synthetic and agent-labeled; it is not human annotation or a field-performance claim. In the current train/validation matrix, source_only and publisher_citation are collinear, so their separate coefficient values are not independently identified.",
        },
        "parityVectors": parity_vectors,
        "schemaContractParityVectors": schema_contract_parity_vectors,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(artifact, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return artifact


def main() -> None:
    parser = argparse.ArgumentParser()
    script_dir = Path(__file__).parent
    parser.add_argument("--vectors", type=Path, default=script_dir / "competitor-discovery-training-vectors.json")
    parser.add_argument("--output", type=Path, default=script_dir.parent / "lib" / "competitor-discovery-model.json")
    args = parser.parse_args()
    artifact = train(args.vectors, args.output)
    print(json.dumps({"output": str(args.output), "metrics": artifact["metrics"]}, indent=2))


if __name__ == "__main__":
    main()
