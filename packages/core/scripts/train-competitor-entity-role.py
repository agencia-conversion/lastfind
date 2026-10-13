#!/usr/bin/env python3
"""Cross-fit and export the portable competitor entity-role span model."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import platform
from pathlib import Path
from typing import Any

import numpy as np
import sklearn
from sklearn.feature_extraction import DictVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score, precision_score, recall_score
from sklearn.model_selection import GroupKFold


MAX_VOCABULARY = 12_000
RANDOM_STATE = 61
ROLE_REGULARIZATION = 0.8
BOUNDARY_NEGATIVE_WEIGHT = 1.5
MAX_LENGTH_WEIGHT_RATIO = 8.0
RANKER_ENTITY_ROLE_OOF_INPUT_SHA256 = "c42ae8e6c8900e5a16d971dde2eeebb8250c7becea771eb70824e6159e6fa29d"
RANKER_ENTITY_ROLE_Z_LO = -11.366828
RANKER_ENTITY_ROLE_Z_HI = 3.849201


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(
        (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()
    ).hexdigest()


def is_candidate_surface_feature(name: str) -> bool:
    return name.startswith("candidate")


def projected_features(features: dict[str, float]) -> dict[str, float]:
    return {
        name: value
        for name, value in features.items()
        if not is_candidate_surface_feature(name)
    }


def ranker_entity_role_transform(score_rows: list[dict[str, Any]]) -> dict[str, Any]:
    selected = sorted(
        (
            {"id": row["id"], "logit": row["logit"], "source": row["source"]}
            for row in score_rows
            if row["source"] == "oof"
        ),
        key=lambda row: row["id"],
    )
    if not selected:
        raise ValueError("ranker entity-role transform requires OOF train logits")
    canonical = (
        json.dumps(selected, ensure_ascii=False, separators=(",", ":")) + "\n"
    ).encode()
    input_sha256 = hashlib.sha256(canonical).hexdigest()
    if input_sha256 != RANKER_ENTITY_ROLE_OOF_INPUT_SHA256:
        raise ValueError("ranker entity-role OOF input differs from the frozen R8 input")
    logits = np.asarray([row["logit"] for row in selected], dtype=float)
    z_lo = round(float(np.percentile(logits, 1, method="linear")), 6)
    z_hi = round(float(np.percentile(logits, 99, method="linear")), 6)
    if (
        not np.isfinite(z_lo)
        or not np.isfinite(z_hi)
        or z_hi <= z_lo
        or z_lo != RANKER_ENTITY_ROLE_Z_LO
        or z_hi != RANKER_ENTITY_ROLE_Z_HI
    ):
        raise ValueError("ranker entity-role transform differs from the frozen R8 constants")
    return {
        "schemaVersion": 1,
        "name": "clipped-affine-logit-percentile",
        "source": "oof-train",
        "percentileMethod": "numpy.percentile(method=linear)",
        "lowerPercentile": 1,
        "upperPercentile": 99,
        "roundingDecimals": 6,
        "zLo": z_lo,
        "zHi": z_hi,
        "formula": "clip((z-zLo)/(zHi-zLo),0,1)",
        "selectedRows": len(selected),
        "inputSha256": input_sha256,
    }


def load_input(path: Path) -> dict[str, Any]:
    artifact = json.loads(path.read_text(encoding="utf-8"))
    if artifact.get("schemaVersion") != 1 or not artifact.get("rows"):
        raise ValueError("unsupported or empty primitive-vector artifact")
    if artifact.get("testEvaluationCount") != 0:
        raise ValueError("sealed test was already evaluated")
    return artifact


def fitted_vocabulary(
    feature_rows: list[dict[str, float]], groups: np.ndarray,
) -> tuple[DictVectorizer, np.ndarray, list[str]]:
    vectorizer = DictVectorizer(sparse=True, sort=True)
    matrix = vectorizer.fit_transform([projected_features(row) for row in feature_rows])
    names = np.asarray(vectorizer.get_feature_names_out())
    # A company surface repeats across answers inside one connected family.
    # Counting rows would promote those family-specific tokens as if they were
    # independent evidence. Vocabulary DF is therefore measured across the
    # same connected components used for the split and cross-fitting.
    document_frequency = np.zeros(matrix.shape[1], dtype=int)
    for group in sorted(set(groups.tolist())):
        indices = np.flatnonzero(groups == group)
        document_frequency += np.asarray(
            (matrix[indices] != 0).sum(axis=0) > 0
        ).ravel().astype(int)
    eligible = [
        index
        for index, frequency in enumerate(document_frequency)
        if frequency >= 2
    ]
    eligible.sort(key=lambda index: (-int(document_frequency[index]), str(names[index])))
    selected = sorted(eligible[:MAX_VOCABULARY], key=lambda index: str(names[index]))
    if not selected:
        raise ValueError("entity-role vocabulary is empty after filtering")
    return vectorizer, np.asarray(selected, dtype=int), [str(names[index]) for index in selected]


def transform(
    vectorizer: DictVectorizer,
    selected: np.ndarray,
    feature_rows: list[dict[str, float]],
):
    return vectorizer.transform([projected_features(row) for row in feature_rows])[:, selected]


def fit_model(
    matrix, labels: np.ndarray, sample_weight: np.ndarray | None = None
) -> LogisticRegression:
    if len(set(labels.tolist())) != 2:
        raise ValueError("every entity-role training fold needs both classes")
    model = LogisticRegression(
        C=ROLE_REGULARIZATION,
        class_weight=None,
        max_iter=2_000,
        solver="liblinear",
        random_state=RANDOM_STATE,
    )
    model.fit(matrix, labels, sample_weight=sample_weight)
    return model


def row_token_count(row: dict[str, Any]) -> int:
    matches = [
        int(name.split("=", 1)[1])
        for name, value in row["features"].items()
        if name.startswith("token_count=") and value == 1
    ]
    if len(matches) != 1 or not 1 <= matches[0] <= 5:
        raise ValueError(f"row {row['id']} needs exactly one token_count feature")
    return matches[0]


def training_weights(rows: list[dict[str, Any]]) -> tuple[np.ndarray, dict[str, Any]]:
    total = len(rows)
    label_counts = {
        label: sum(row["label"] == label for row in rows) for label in (0, 1)
    }
    if min(label_counts.values()) == 0:
        raise ValueError("training weights require both classes")
    bucket_counts = {
        bucket: {
            label: sum(
                row["label"] == label and row_token_count(row) == bucket
                for row in rows
            )
            for label in (0, 1)
        }
        for bucket in range(1, 6)
    }
    raw_weights: list[float] = []
    row_audit: list[tuple[int, int, float, float, float, float]] = []
    for row in rows:
        label = int(row["label"])
        bucket = row_token_count(row)
        global_class_weight = total / (2 * label_counts[label])
        counts = bucket_counts[bucket]
        if counts[0] and counts[1]:
            bucket_total = counts[0] + counts[1]
            bucket_class_weight = bucket_total / (2 * counts[label])
            uncapped_length_multiplier = bucket_class_weight / global_class_weight
            length_multiplier = min(
                MAX_LENGTH_WEIGHT_RATIO,
                max(
                    1 / MAX_LENGTH_WEIGHT_RATIO,
                    uncapped_length_multiplier,
                ),
            )
        else:
            uncapped_length_multiplier = 1.0
            length_multiplier = 1.0
        boundary_multiplier = (
            BOUNDARY_NEGATIVE_WEIGHT
            if label == 0 and "boundary" in row.get("strata", [])
            else 1.0
        )
        weight = global_class_weight * length_multiplier * boundary_multiplier
        raw_weights.append(weight)
        row_audit.append(
            (
                label,
                bucket,
                global_class_weight,
                uncapped_length_multiplier,
                length_multiplier,
                boundary_multiplier,
            )
        )
    mean_weight = sum(raw_weights) / len(raw_weights)
    weights = np.asarray([weight / mean_weight for weight in raw_weights], dtype=float)
    audit_buckets: dict[str, Any] = {}
    for bucket in range(1, 6):
        audit_buckets[str(bucket)] = {}
        for label in (0, 1):
            indices = [
                index
                for index, (row_label, row_bucket, *_rest) in enumerate(row_audit)
                if row_label == label and row_bucket == bucket
            ]
            audit_buckets[str(bucket)][str(label)] = {
                "rows": len(indices),
                "weightMass": round(float(weights[indices].sum()), 6) if indices else 0,
                "lengthMultipliers": sorted(
                    {round(row_audit[index][4], 6) for index in indices}
                ),
                "uncappedLengthMultipliers": sorted(
                    {round(row_audit[index][3], 6) for index in indices}
                ),
            }
    audit = {
        "formula": "g_y=N/(2*N_y); when both labels occur in length bucket b, m_yb=clip((N_b/(2*N_yb))/g_y,1/8,8), otherwise m_yb=1; effective=g_y*m_yb*boundary; normalize global mean to 1",
        "classWeight": None,
        "boundaryNegativeWeight": BOUNDARY_NEGATIVE_WEIGHT,
        "maxLengthWeightRatio": MAX_LENGTH_WEIGHT_RATIO,
        "globalMeanBeforeNormalization": round(mean_weight, 12),
        "labelCounts": {str(key): value for key, value in label_counts.items()},
        "labelWeightMass": {
            str(label): round(
                float(weights[[row["label"] == label for row in rows]].sum()), 6
            )
            for label in (0, 1)
        },
        "byTokenCount": audit_buckets,
    }
    return weights, audit


def decoded_indices(
    rows: list[dict[str, Any]], logits: np.ndarray, penalty: float
) -> set[int]:
    by_answer: dict[str, list[int]] = {}
    for index, row in enumerate(rows):
        key = f"{row['bundleId']}:{row['answerId']}"
        by_answer.setdefault(key, []).append(index)
    selected: set[int] = set()
    for indices in by_answer.values():
        intervals = sorted(
            indices,
            key=lambda index: (
                rows[index]["end"],
                rows[index]["start"],
                -(rows[index]["end"] - rows[index]["start"]),
                rows[index]["normalizedName"],
            ),
        )
        previous: list[int] = []
        for position, row_index in enumerate(intervals):
            found = -1
            low, high = 0, position - 1
            while low <= high:
                middle = (low + high) // 2
                if rows[intervals[middle]]["end"] <= rows[row_index]["start"]:
                    found = middle
                    low = middle + 1
                else:
                    high = middle - 1
            previous.append(found)
        states: list[tuple[float, tuple[int, ...]]] = [(0.0, ())]
        for position, row_index in enumerate(intervals):
            predecessor = states[previous[position] + 1]
            include = (
                predecessor[0] + float(logits[row_index]) - penalty,
                (*predecessor[1], row_index),
            )
            exclude = states[position]
            if include[0] > exclude[0] + 1e-12:
                states.append(include)
            elif exclude[0] > include[0] + 1e-12:
                states.append(exclude)
            else:
                def tie_key(state: tuple[float, tuple[int, ...]]) -> tuple[Any, ...]:
                    ordered = sorted(
                        state[1],
                        key=lambda index: (
                            rows[index]["start"],
                            -(rows[index]["end"] - rows[index]["start"]),
                            rows[index]["normalizedName"],
                        ),
                    )
                    return tuple(
                        (
                            rows[index]["start"],
                            -(rows[index]["end"] - rows[index]["start"]),
                            rows[index]["normalizedName"],
                        )
                        for index in ordered
                    )
                states.append(include if tie_key(include) < tie_key(exclude) else exclude)
        selected.update(states[-1][1])
    return selected


def binary_metrics(labels: np.ndarray, predicted: np.ndarray) -> dict[str, float | int]:
    return {
        "rows": int(len(labels)),
        "positives": int(labels.sum()),
        "precision": round(float(precision_score(labels, predicted, zero_division=0)), 6),
        "recall": round(float(recall_score(labels, predicted, zero_division=0)), 6),
        "f1": round(float(f1_score(labels, predicted, zero_division=0)), 6),
    }


def choose_segment_penalty(
    rows: list[dict[str, Any]], labels: np.ndarray, logits: np.ndarray
) -> tuple[float, dict[str, Any]]:
    finite = np.asarray(sorted(set(round(float(value), 6) for value in logits)))
    quantiles = np.quantile(finite, [0.1, 0.25, 0.5, 0.75, 0.9]) if len(finite) else np.asarray([0.0])
    candidates = sorted(set([0.0, *[max(0.0, round(float(value), 6)) for value in quantiles]]))
    ranked: list[tuple[float, float, float, float, dict[str, Any]]] = []
    for penalty in candidates:
        selected = decoded_indices(rows, logits, penalty)
        predicted = np.asarray([index in selected for index in range(len(rows))], dtype=int)
        metric = binary_metrics(labels, predicted)
        ranked.append((
            float(metric["f1"]),
            float(metric["precision"]),
            float(metric["recall"]),
            penalty,
            metric,
        ))
    best = max(ranked, key=lambda item: (item[0], item[1], item[2], item[3]))
    return best[3], {"selection": "OOF train boundary F1, precision, recall, then larger penalty", "candidates": [item[3] for item in ranked], "metrics": best[4]}


def choose_cutoff(
    rows: list[dict[str, Any]], labels: np.ndarray, logits: np.ndarray, penalty: float
) -> tuple[float, dict[str, Any]]:
    decoded = decoded_indices(rows, logits, penalty)
    probabilities = 1.0 / (1.0 + np.exp(-logits))
    candidates = sorted(set([0.0, 1.0, *[float(probabilities[index]) for index in decoded]]))
    ranked: list[tuple[float, float, float, float, dict[str, Any]]] = []
    for cutoff in candidates:
        predicted = np.asarray(
            [index in decoded and probabilities[index] >= cutoff for index in range(len(rows))],
            dtype=int,
        )
        metric = binary_metrics(labels, predicted)
        precision = float(metric["precision"])
        recall = float(metric["recall"])
        f2 = 0.0 if 4 * precision + recall == 0 else 5 * precision * recall / (4 * precision + recall)
        ranked.append((f2, precision, recall, cutoff, metric))
    best = max(ranked, key=lambda item: (item[0], item[1], item[2], item[3]))
    return round(best[3], 12), {"selection": "validation F2, precision, recall, then higher cutoff", "metrics": best[4], "f2": round(best[0], 6)}


def quantiles(values: np.ndarray) -> dict[str, float]:
    return {
        name: round(float(np.quantile(values, point)), 6)
        for name, point in [("p05", 0.05), ("p25", 0.25), ("p50", 0.5), ("p75", 0.75), ("p95", 0.95)]
    }


def train(primitives_path: Path, model_output: Path, scores_output: Path) -> dict[str, Any]:
    artifact = load_input(primitives_path)
    all_rows = artifact["rows"]
    train_rows = [row for row in all_rows if row["partition"] == "train" and row["label"] in {0, 1}]
    validation_rows = [row for row in all_rows if row["partition"] == "validation" and row["label"] in {0, 1}]
    test_rows = [row for row in all_rows if row["partition"] == "test"]
    for name, rows in [("train", train_rows), ("validation", validation_rows)]:
        if not rows or {row["label"] for row in rows} != {0, 1}:
            raise ValueError(f"{name} needs positive and negative entity-role spans")
    groups = np.asarray([row["component"] for row in train_rows])
    unique_groups = sorted(set(groups.tolist()))
    folds = min(5, len(unique_groups))
    if folds < 3:
        raise ValueError("entity-role cross-fitting requires at least three train components")
    train_labels = np.asarray([row["label"] for row in train_rows], dtype=int)
    oof_logits = np.full(len(train_rows), np.nan)
    fold_audit: list[dict[str, Any]] = []
    splitter = GroupKFold(n_splits=folds)
    for fold, (fit_indices, held_indices) in enumerate(splitter.split(train_rows, train_labels, groups)):
        fit_rows = [train_rows[index] for index in fit_indices]
        held_rows = [train_rows[index] for index in held_indices]
        vectorizer, selected, vocabulary = fitted_vocabulary(
            [row["features"] for row in fit_rows], groups[fit_indices]
        )
        fit_features = [row["features"] for row in fit_rows]
        fit_matrix = transform(vectorizer, selected, fit_features)
        held_matrix = transform(vectorizer, selected, [row["features"] for row in held_rows])
        fold_weights, fold_weight_audit = training_weights(fit_rows)
        model = fit_model(
            fit_matrix,
            train_labels[fit_indices],
            fold_weights,
        )
        oof_logits[held_indices] = model.decision_function(held_matrix)
        fit_components = sorted(set(groups[fit_indices].tolist()))
        held_components = sorted(set(groups[held_indices].tolist()))
        if set(fit_components) & set(held_components):
            raise ValueError("OOF fold leaks a held component")
        fold_audit.append({
            "fold": fold,
            "fitComponents": fit_components,
            "heldComponents": held_components,
            "vocabularySize": len(vocabulary),
            "vocabularySha256": hashlib.sha256(("\n".join(vocabulary) + "\n").encode()).hexdigest(),
            "trainingWeightAudit": fold_weight_audit,
        })
    if not np.isfinite(oof_logits).all():
        raise ValueError("OOF scoring did not cover every train span")

    segment_penalty, penalty_audit = choose_segment_penalty(train_rows, train_labels, oof_logits)
    final_vectorizer, final_selected, final_vocabulary = fitted_vocabulary(
        [row["features"] for row in train_rows], groups
    )
    final_weights, final_weight_audit = training_weights(train_rows)
    final_model = fit_model(
        transform(final_vectorizer, final_selected, [row["features"] for row in train_rows]),
        train_labels,
        final_weights,
    )
    final_train_logits = final_model.decision_function(
        transform(final_vectorizer, final_selected, [row["features"] for row in train_rows])
    )
    validation_logits = final_model.decision_function(
        transform(final_vectorizer, final_selected, [row["features"] for row in validation_rows])
    )
    role_cutoff, cutoff_audit = choose_cutoff(
        validation_rows,
        np.asarray([row["label"] for row in validation_rows], dtype=int),
        validation_logits,
        segment_penalty,
    )

    test_logits = (
        final_model.decision_function(
            transform(final_vectorizer, final_selected, [row["features"] for row in test_rows])
        )
        if test_rows
        else np.asarray([], dtype=float)
    )
    selected_names = np.asarray(final_vectorizer.get_feature_names_out())[final_selected]
    coefficients = final_model.coef_[0]
    ordered = sorted(range(len(final_vocabulary)), key=lambda index: str(selected_names[index]))
    vocabulary = [str(selected_names[index]) for index in ordered]
    if any(is_candidate_surface_feature(name) for name in vocabulary):
        raise ValueError("candidate surface feature leaked into final vocabulary")
    ordered_coefficients = [round(float(coefficients[index]), 12) for index in ordered]

    final_logits_by_id = {
        row["id"]: float(logit)
        for rows, logits in [
            (train_rows, final_train_logits),
            (validation_rows, validation_logits),
            (test_rows, test_logits),
        ]
        for row, logit in zip(rows, logits, strict=True)
    }
    oof_logits_by_id = {row["id"]: float(logit) for row, logit in zip(train_rows, oof_logits, strict=True)}
    score_rows = []
    for row in all_rows:
        if row["partition"] == "test":
            logit = final_logits_by_id[row["id"]]
            source = "final-sealed-test-label-blind"
        elif row["label"] == "ambiguous":
            matrix = transform(final_vectorizer, final_selected, [row["features"]])
            logit = float(final_model.decision_function(matrix)[0])
            source = "final-ambiguous"
        elif row["partition"] == "train":
            logit = oof_logits_by_id[row["id"]]
            source = "oof"
        else:
            logit = final_logits_by_id[row["id"]]
            source = "final"
        score_rows.append({
            "id": row["id"],
            "logit": round(logit, 12),
            "score": round(1.0 / (1.0 + math.exp(-logit)), 12),
            "source": source,
        })
    entity_role_transform = ranker_entity_role_transform(score_rows)

    parity_source = validation_rows[:8]
    parity_vectors = []
    for row in parity_source:
        logit = final_logits_by_id[row["id"]]
        parity_vectors.append({
            "id": row["id"],
            "features": row["features"],
            "logit": round(logit, 12),
            "score": round(1.0 / (1.0 + math.exp(-logit)), 12),
        })

    scores_artifact = {
        "schemaVersion": 1,
        "datasetVersion": artifact["datasetVersion"],
        "primitiveVectorsSha256": hashlib.sha256(primitives_path.read_bytes()).hexdigest(),
        "entityRoleModelParametersSha256": canonical_sha256({
            "schemaVersion": 1,
            "featureVocabulary": vocabulary,
            "intercept": round(float(final_model.intercept_[0]), 12),
            "coefficients": ordered_coefficients,
            "decisionThreshold": role_cutoff,
            "segmentPenalty": round(float(segment_penalty), 12),
        }),
        "testSealSha256": artifact["testSealSha256"],
        "testEvaluationCount": 0,
        "sealedTestScoring": (
            "Final train-only span model; test labels were not read for scoring or metrics."
            if test_rows
            else "No test rows were present; replacement test remains withheld pending QA."
        ),
        "segmentPenalty": round(float(segment_penalty), 12),
        "decisionThreshold": role_cutoff,
        "rankerEntityRoleTransform": entity_role_transform,
        "foldAudit": fold_audit,
        "oofVsFinalScoreQuantiles": {
            "oof": quantiles(1.0 / (1.0 + np.exp(-oof_logits))),
            "finalOnTrain": quantiles(1.0 / (1.0 + np.exp(-final_train_logits))),
            "delta": quantiles(
                1.0 / (1.0 + np.exp(-final_train_logits))
                - 1.0 / (1.0 + np.exp(-oof_logits))
            ),
        },
        "rows": score_rows,
    }
    scores_output.write_text(json.dumps(scores_artifact, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    model_artifact = {
        "schemaVersion": 1,
        "modelType": "sklearn.linear_model.LogisticRegression",
        "classOrder": [0, 1],
        "featureVocabulary": vocabulary,
        "intercept": round(float(final_model.intercept_[0]), 12),
        "coefficients": ordered_coefficients,
        "decisionThreshold": role_cutoff,
        "segmentPenalty": round(float(segment_penalty), 12),
        "rankerEntityRoleTransform": entity_role_transform,
        "provenance": {
            "datasetVersion": artifact["datasetVersion"],
            "primitiveSourceSha256": artifact["primitiveSourceSha256"],
            "corpusSha256": artifact["corpusSha256"],
            "primitiveVectorsSha256": hashlib.sha256(primitives_path.read_bytes()).hexdigest(),
            "splitPolicy": artifact["splitPolicy"],
            "testSealSha256": artifact["testSealSha256"],
            "testEvaluationCount": 0,
            "customerDataUsed": False,
            "humanAnnotationUsed": False,
            "randomState": RANDOM_STATE,
            "regularizationC": ROLE_REGULARIZATION,
            "boundaryNegativeWeight": BOUNDARY_NEGATIVE_WEIGHT,
            "lengthWeightPolicy": final_weight_audit,
            "pythonVersion": platform.python_version(),
            "scikitLearnVersion": sklearn.__version__,
            "foldAudit": fold_audit,
        },
        "metrics": {
            "evaluation": "Train/validation fit only; sealed test labels were not evaluated in this phase.",
            "segmentPenaltySelection": penalty_audit,
            "thresholdSelection": cutoff_audit,
            "oofVsFinalScoreQuantiles": scores_artifact["oofVsFinalScoreQuantiles"],
        },
        "parityVectors": parity_vectors,
    }
    model_output.write_text(json.dumps(model_artifact, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return model_artifact


def main() -> None:
    parser = argparse.ArgumentParser()
    script_dir = Path(__file__).parent
    parser.add_argument("--primitives", type=Path, default=script_dir / "competitor-entity-role-primitives.json")
    parser.add_argument("--model", type=Path, default=script_dir.parent / "lib" / "competitor-entity-role-model.json")
    parser.add_argument("--scores", type=Path, default=script_dir / "competitor-entity-role-scores.json")
    args = parser.parse_args()
    artifact = train(args.primitives, args.model, args.scores)
    print(json.dumps({"model": str(args.model), "scores": str(args.scores), "metrics": artifact["metrics"]}, indent=2))


if __name__ == "__main__":
    main()
