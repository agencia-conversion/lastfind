#!/usr/bin/env python3
"""Evaluate the sealed synthetic test exactly once after both models are fixed."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score, roc_auc_score


FEATURE_ORDER = [
    "context_similarity", "primary_context_similarity", "seed_proximity",
    "structure_similarity", "list_table_role", "comparison_language",
    "repeated_mention", "name_quality", "direct_domain", "source_only",
    "heading_only", "generic_entity", "publisher_citation", "answer_support",
    "distinct_link_domains_per_surface", "link_label_only",
    "mwis_primary_fraction", "entity_role",
]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(
        (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()
    ).hexdigest()


def role_parameter_sha256(role_model: dict[str, Any]) -> str:
    return canonical_sha256(
        {
            "schemaVersion": int(role_model["schemaVersion"]),
            "featureVocabulary": role_model["featureVocabulary"],
            "intercept": float(role_model["intercept"]),
            "coefficients": [float(value) for value in role_model["coefficients"]],
            "decisionThreshold": float(role_model["decisionThreshold"]),
            "segmentPenalty": float(role_model["segmentPenalty"]),
        }
    )


def validate_artifact_chain(
    primitives: dict[str, Any],
    scores: dict[str, Any],
    vectors: dict[str, Any],
    corpus: dict[str, Any],
    role_model: dict[str, Any],
    ranker: dict[str, Any],
    primitives_path: Path,
    scores_path: Path,
    vectors_path: Path,
    corpus_path: Path,
    primitive_source_path: Path,
    feature_source_path: Path,
    identity_source_path: Path,
) -> None:
    coefficients = ranker.get("coefficients")
    if (
        ranker.get("schemaVersion") != 6
        or ranker.get("classOrder") != [0, 1]
        or ranker.get("featureOrder") != FEATURE_ORDER
        or vectors.get("schemaVersion") != 6
        or vectors.get("featureOrder") != FEATURE_ORDER
        or not isinstance(coefficients, list)
        or len(coefficients) != len(FEATURE_ORDER)
        or not all(
            isinstance(value, (int, float))
            and not isinstance(value, bool)
            and math.isfinite(value)
            for value in coefficients
        )
        or not isinstance(ranker.get("intercept"), (int, float))
        or isinstance(ranker.get("intercept"), bool)
        or not math.isfinite(ranker["intercept"])
        or not isinstance(ranker.get("decisionThreshold"), (int, float))
        or isinstance(ranker.get("decisionThreshold"), bool)
        or not math.isfinite(ranker["decisionThreshold"])
        or not 0 <= ranker["decisionThreshold"] <= 1
    ):
        raise ValueError("invalid ranker schema or parameters")
    rows = vectors.get("rows")
    if not isinstance(rows, list):
        raise ValueError("invalid ranker vector rows")
    for row in rows:
        features = row.get("features") if isinstance(row, dict) else None
        if (
            not isinstance(features, dict)
            or len(features) != len(FEATURE_ORDER)
            or set(features) != set(FEATURE_ORDER)
        ):
            raise ValueError("invalid ranker vector feature schema")
    corpus_hash = sha256(corpus_path)
    primitive_source_hash = sha256(primitive_source_path)
    feature_source_hash = sha256(feature_source_path)
    identity_source_hash = sha256(identity_source_path)
    primitives_hash = sha256(primitives_path)
    scores_hash = sha256(scores_path)
    vectors_hash = sha256(vectors_path)
    parameter_hash = role_parameter_sha256(role_model)
    primitive_rows_hash = hashlib.sha256(
        json.dumps(
            primitives.get("rows"), ensure_ascii=False, separators=(",", ":")
        ).encode()
    ).hexdigest()
    expected = [
        (primitives.get("corpusSha256"), corpus_hash, "primitive corpus"),
        (primitives.get("primitiveSourceSha256"), primitive_source_hash, "primitive source"),
        (scores.get("primitiveVectorsSha256"), primitives_hash, "score primitives"),
        (scores.get("entityRoleModelParametersSha256"), parameter_hash, "score role parameters"),
        (vectors.get("corpusSha256"), corpus_hash, "vector corpus"),
        (vectors.get("primitiveVectorsSha256"), primitives_hash, "vector primitives"),
        (vectors.get("entityRoleScoresSha256"), scores_hash, "vector role scores"),
        (vectors.get("featureSourceSha256"), feature_source_hash, "vector feature source"),
        (vectors.get("primitiveImplementationSha256"), primitive_source_hash, "vector primitive source"),
        (vectors.get("identityImplementationSha256"), identity_source_hash, "vector identity source"),
        (vectors.get("entityRoleModelParametersSha256"), parameter_hash, "vector role parameters"),
        (ranker.get("provenance", {}).get("sourceCorpusSha256"), corpus_hash, "ranker corpus"),
        (ranker.get("provenance", {}).get("trainingVectorsSha256"), vectors_hash, "ranker vectors"),
        (ranker.get("provenance", {}).get("primitiveVectorsSha256"), primitives_hash, "ranker primitives"),
        (ranker.get("provenance", {}).get("entityRoleScoresSha256"), scores_hash, "ranker role scores"),
        (ranker.get("provenance", {}).get("featureSourceSha256"), feature_source_hash, "ranker feature source"),
        (ranker.get("provenance", {}).get("primitiveImplementationSha256"), primitive_source_hash, "ranker primitive source"),
        (ranker.get("provenance", {}).get("identityImplementationSha256"), identity_source_hash, "ranker identity source"),
        (ranker.get("provenance", {}).get("entityRoleModelParametersSha256"), parameter_hash, "ranker role parameters"),
    ]
    for observed, wanted, label in expected:
        if observed != wanted:
            raise ValueError(f"artifact provenance mismatch: {label}")
    role_provenance = role_model.get("provenance", {})
    direct_fit = (
        role_provenance.get("primitiveSourceSha256") == primitive_source_hash
        and role_provenance.get("primitiveVectorsSha256") == primitives_hash
    )
    compatible_reuse = (
        role_provenance.get("compatibleRuntimePrimitiveSourceSha256")
        == primitive_source_hash
        and role_provenance.get("compatibleRuntimePrimitiveVectorsSha256")
        == primitives_hash
        and isinstance(role_provenance.get("fitPrimitiveSourceSha256"), str)
        and re.fullmatch(
            r"[a-f0-9]{64}", role_provenance["fitPrimitiveSourceSha256"]
        ) is not None
        and isinstance(role_provenance.get("fitPrimitiveVectorsSha256"), str)
        and re.fullmatch(
            r"[a-f0-9]{64}", role_provenance["fitPrimitiveVectorsSha256"]
        ) is not None
        and role_provenance.get("compatibleRuntimePrimitiveRowsSha256")
        == primitive_rows_hash
        and scores.get("compatibleRuntimePrimitiveRowsSha256")
        == primitive_rows_hash
        and scores.get("fitPrimitiveVectorsSha256")
        == role_provenance.get("fitPrimitiveVectorsSha256")
    )
    if not direct_fit and not compatible_reuse:
        raise ValueError("role model runtime compatibility provenance mismatch")
    if corpus.get("datasetVersion") != primitives.get("datasetVersion"):
        raise ValueError("artifact dataset versions differ")


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
        or not math.isfinite(z_lo)
        or not math.isfinite(z_hi)
        or z_hi <= z_lo
    ):
        raise ValueError("invalid ranker entity-role transform bounds")
    return value


def binary_metrics(labels: np.ndarray, probabilities: np.ndarray, threshold: float) -> dict[str, Any]:
    predicted = probabilities >= threshold
    result: dict[str, Any] = {
        "rows": int(len(labels)),
        "positives": int(labels.sum()),
        "accuracy": round(float(accuracy_score(labels, predicted)), 6),
        "precision": round(float(precision_score(labels, predicted, zero_division=0)), 6),
        "recall": round(float(recall_score(labels, predicted, zero_division=0)), 6),
        "f1": round(float(f1_score(labels, predicted, zero_division=0)), 6),
    }
    if len(set(labels.tolist())) == 2:
        result["rocAuc"] = round(float(roc_auc_score(labels, probabilities)), 6)
    return result


def decoded_indices(rows: list[dict[str, Any]], logits: np.ndarray, penalty: float) -> set[int]:
    by_answer: dict[str, list[int]] = {}
    for index, row in enumerate(rows):
        by_answer.setdefault(f"{row['bundleId']}:{row['answerId']}", []).append(index)
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
            low, high, found = 0, position - 1, -1
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
                def key(state: tuple[float, tuple[int, ...]]) -> tuple[Any, ...]:
                    return tuple(
                        (
                            rows[index]["start"],
                            -(rows[index]["end"] - rows[index]["start"]),
                            rows[index]["normalizedName"],
                        )
                        for index in sorted(
                            state[1],
                            key=lambda index: (
                                rows[index]["start"],
                                -(rows[index]["end"] - rows[index]["start"]),
                                rows[index]["normalizedName"],
                            ),
                        )
                    )
                states.append(include if key(include) < key(exclude) else exclude)
        selected.update(states[-1][1])
    return selected


def utf16_slice(value: str, start: int, end: int) -> str:
    encoded = value.encode("utf-16-le")
    return encoded[start * 2 : end * 2].decode("utf-16-le")


def span_metrics(
    primitives: dict[str, Any], scores: dict[str, Any], role_model: dict[str, Any], corpus: dict[str, Any]
) -> dict[str, Any]:
    rows = [row for row in primitives["rows"] if row["partition"] == "test"]
    if any(row["label"] != "sealed" for row in rows):
        raise ValueError("entity-role test labels were exposed before final evaluation")

    primitive_ids = [row["id"] for row in primitives["rows"]]
    score_ids = [row["id"] for row in scores["rows"]]
    if len(set(primitive_ids)) != len(primitive_ids) or len(set(score_ids)) != len(score_ids):
        raise ValueError("duplicate entity-role primitive or score id")
    if set(primitive_ids) != set(score_ids):
        raise ValueError("entity-role score coverage differs from primitive rows")

    declared_positive_keys: set[tuple[str, str, int, int]] = set()
    annotation_by_key: dict[tuple[str, str, int, int], int] = {}
    for bundle in corpus["bundles"]:
        if bundle["partition"] != "test":
            continue
        answers = {answer["id"]: answer["answer"] for answer in bundle["answers"]}
        for span in bundle["declaredPositiveSpans"]:
            answer = answers.get(span["answerId"])
            if answer is None or utf16_slice(answer, int(span["start"]), int(span["end"])) != span["name"]:
                raise ValueError("declared test positive span drifted")
            key = (bundle["id"], span["answerId"], int(span["start"]), int(span["end"]))
            if key in declared_positive_keys:
                raise ValueError("duplicate declared test positive span")
            declared_positive_keys.add(key)
        for annotation in bundle["annotations"]:
            if annotation["label"] not in {0, 1}:
                raise ValueError("test annotation must have an explicit binary label")
            answer = answers.get(annotation["answerId"])
            if (
                answer is None
                or utf16_slice(answer, int(annotation["start"]), int(annotation["end"]))
                != annotation["name"]
            ):
                raise ValueError("test annotation span drifted")
            key = (
                bundle["id"],
                annotation["answerId"],
                int(annotation["start"]),
                int(annotation["end"]),
            )
            if key in annotation_by_key:
                raise ValueError("duplicate test annotation")
            annotation_by_key[key] = int(annotation["label"])
    annotation_positive_keys = {
        key for key, label in annotation_by_key.items() if label == 1
    }
    if annotation_positive_keys != declared_positive_keys:
        raise ValueError(
            "positive test annotations differ from declared positive spans"
        )

    score_by_id = {row["id"]: row for row in scores["rows"]}
    logits = np.asarray([float(score_by_id[row["id"]]["logit"]) for row in rows])
    if not np.isfinite(logits).all():
        raise ValueError("entity-role test score is not finite")
    probabilities = 1.0 / (1.0 + np.exp(-logits))
    selected = decoded_indices(rows, logits, float(role_model["segmentPenalty"]))
    threshold = float(role_model["decisionThreshold"])
    predicted = np.asarray(
        [index in selected and probabilities[index] >= threshold for index in range(len(rows))],
        dtype=int,
    )
    row_keys = [
        (row["bundleId"], row["answerId"], int(row["start"]), int(row["end"]))
        for row in rows
    ]
    if len(set(row_keys)) != len(row_keys):
        raise ValueError("duplicate entity-role test span")
    annotated_indices = [index for index, key in enumerate(row_keys) if key in annotation_by_key]
    annotated_labels = np.asarray([annotation_by_key[row_keys[index]] for index in annotated_indices])
    annotated_predictions = predicted[annotated_indices]
    if annotated_indices:
        conditional_precision = precision_score(
            annotated_labels, annotated_predictions, zero_division=0
        )
        conditional_recall = recall_score(annotated_labels, annotated_predictions, zero_division=0)
        conditional_f1 = f1_score(annotated_labels, annotated_predictions, zero_division=0)
    else:
        conditional_precision = conditional_recall = conditional_f1 = 0.0

    declared_positives = len(declared_positive_keys)
    row_key_set = set(row_keys)
    recovered_positives = len(declared_positive_keys & row_key_set)
    selected_indices = [index for index, value in enumerate(predicted) if value == 1]
    true_positives = sum(row_keys[index] in declared_positive_keys for index in selected_indices)
    false_positives = len(selected_indices) - true_positives
    false_negatives = declared_positives - true_positives
    precision = true_positives / (true_positives + false_positives) if true_positives + false_positives else 0
    recall = true_positives / declared_positives if declared_positives else 0
    return {
        "scoreCoverage": {
            "testPrimitiveRows": len(rows),
            "allPrimitiveRows": len(primitive_ids),
            "allScoreRows": len(score_ids),
        },
        "annotationCoverage": {
            "declaredAnnotations": len(annotation_by_key),
            "declaredPositiveAnnotations": sum(value == 1 for value in annotation_by_key.values()),
            "declaredNegativeAnnotations": sum(value == 0 for value in annotation_by_key.values()),
            "matchedAnnotationRows": len(annotated_indices),
            "omittedAnnotatedSpans": len(set(annotation_by_key) - row_key_set),
            "unannotatedRows": len(rows) - len(annotated_indices),
            "selectedWithAnnotation": sum(
                row_keys[index] in annotation_by_key for index in selected_indices
            ),
            "selectedWithoutAnnotation": sum(
                row_keys[index] not in annotation_by_key for index in selected_indices
            ),
        },
        "conditionalOnExplicitAnnotations": {
            "rows": len(annotated_indices),
            "positives": int(annotated_labels.sum()),
            "precision": round(float(conditional_precision), 6),
            "recall": round(float(conditional_recall), 6),
            "f1": round(float(conditional_f1), 6),
        },
        "endToEnd": {
            "declaredPositiveSpans": declared_positives,
            "recoveredPositiveSpans": recovered_positives,
            "omittedBeforeScoring": declared_positives - recovered_positives,
            "selectedSpans": len(selected_indices),
            "selectedOutsideDeclaredPositiveGold": false_positives,
            "truePositives": true_positives,
            "falsePositives": false_positives,
            "falseNegatives": false_negatives,
            "precision": round(precision, 6),
            "recall": round(recall, 6),
            "f1": round(2 * precision * recall / (precision + recall), 6) if precision + recall else 0,
        },
    }


def normalized(value: str) -> str:
    import unicodedata
    decomposed = unicodedata.normalize("NFKD", value)
    plain = "".join(character for character in decomposed if not unicodedata.combining(character)).lower()
    return " ".join("".join(character if character.isalnum() else " " for character in plain).split())


def ranker_metrics(
    vectors: dict[str, Any], ranker: dict[str, Any], corpus: dict[str, Any]
) -> dict[str, Any]:
    rows = [row for row in vectors["rows"] if row["partition"] == "test"]
    positive_names = {
        bundle["id"]: {
            normalized(span["name"])
            for span in bundle["declaredPositiveSpans"]
        }
        for bundle in corpus["bundles"]
        if bundle["partition"] == "test"
    }
    order = ranker["featureOrder"]
    matrix = np.asarray([[row["features"][name] for name in order] for row in rows], dtype=float)
    decision = matrix @ np.asarray(ranker["coefficients"], dtype=float) + float(ranker["intercept"])
    probabilities = 1.0 / (1.0 + np.exp(-decision))
    if any(row["label"] != "sealed" for row in rows):
        raise ValueError("ranker test labels were exposed before final evaluation")
    labels = np.asarray(
        [int(normalized(row["candidate"]) in positive_names[row["documentId"]]) for row in rows],
        dtype=int,
    )
    threshold = float(ranker["decisionThreshold"])
    selected = probabilities >= threshold
    slices: dict[str, Any] = {}
    selectors = {
        "en": lambda row: row["locale"] == "en",
        "pt-BR": lambda row: row["locale"] == "pt-BR",
        "oneToken": lambda row: len(row["candidate"].split()) == 1,
        "prose": lambda row: row["features"]["list_table_role"] == 0 and row["features"]["heading_only"] == 0,
        "structured": lambda row: row["features"]["list_table_role"] == 1 or row["features"]["heading_only"] == 1,
        "publisher": lambda row: row["features"]["publisher_citation"] > 0,
        "generic": lambda row: row["features"]["generic_entity"] >= 0.5,
    }
    for name, selector in selectors.items():
        indices = [index for index, row in enumerate(rows) if selector(row)]
        if indices:
            slices[name] = binary_metrics(labels[indices], probabilities[indices], threshold)
    source_indices = [index for index, row in enumerate(rows) if row["features"]["source_only"] == 1]
    by_bundle: dict[str, Any] = {}
    for bundle_id, expected in sorted(positive_names.items()):
        indices = [index for index, row in enumerate(rows) if row["documentId"] == bundle_id]
        emitted = {normalized(rows[index]["candidate"]) for index in indices}
        chosen = {normalized(rows[index]["candidate"]) for index in indices if selected[index]}
        true_positives = len(chosen & expected)
        false_positives = len(chosen - expected)
        by_bundle[bundle_id] = {
            "expectedPositives": len(expected),
            "emittedExpectedPositives": len(emitted & expected),
            "omittedUpstream": len(expected - emitted),
            "selected": len(chosen),
            "truePositives": true_positives,
            "falsePositives": false_positives,
            "falseNegatives": len(expected) - true_positives,
        }
    totals = {
        key: sum(bundle[key] for bundle in by_bundle.values())
        for key in [
            "expectedPositives", "emittedExpectedPositives", "omittedUpstream",
            "selected", "truePositives", "falsePositives", "falseNegatives",
        ]
    }
    precision = totals["truePositives"] / (totals["truePositives"] + totals["falsePositives"]) if totals["truePositives"] + totals["falsePositives"] else 0
    recall = totals["truePositives"] / totals["expectedPositives"] if totals["expectedPositives"] else 0
    return {
        "conditionalOnEmitted": binary_metrics(labels, probabilities, threshold),
        "endToEnd": {
            **totals,
            "precision": round(precision, 6),
            "recall": round(recall, 6),
            "f1": round(2 * precision * recall / (precision + recall), 6) if precision + recall else 0,
            "byBundle": by_bundle,
        },
        "slices": slices,
        "maxSourceOnlyScore": (
            round(float(max(probabilities[index] for index in source_indices)), 6)
            if source_indices else None
        ),
    }


def apply_tracker(
    tracker: dict[str, Any], tracker_path: Path, role_path: Path, ranker_path: Path
) -> int:
    tracker_hash = sha256(tracker_path)
    role_model = json.loads(role_path.read_text(encoding="utf-8"))
    ranker = json.loads(ranker_path.read_text(encoding="utf-8"))
    ranker["provenance"]["testEvaluationCount"] = 1
    ranker["provenance"]["evaluationId"] = tracker["evaluationId"]
    ranker["provenance"]["evaluationTrackerSha256"] = tracker_hash
    ranker["metrics"]["syntheticHoldout"] = tracker["metrics"]["ranker"]["endToEnd"]
    ranker["metrics"]["syntheticHoldoutConditionalOnEmitted"] = tracker["metrics"]["ranker"]["conditionalOnEmitted"]
    ranker["metrics"]["syntheticHoldoutSlices"] = tracker["metrics"]["ranker"]["slices"]
    ranker["metrics"]["maxSourceOnlyScore"] = tracker["metrics"]["ranker"]["maxSourceOnlyScore"]
    ranker["metrics"]["maxSourceOnlyScoreScope"] = "synthetic-holdout"
    ranker_output = json.dumps(ranker, ensure_ascii=False, indent=2) + "\n"
    runtime_model_bytes = role_path.stat().st_size + len(ranker_output.encode())
    if runtime_model_bytes > 1_048_576:
        raise ValueError("combined runtime model artifacts exceed 1 MiB after evaluation metadata")
    ranker_path.write_text(ranker_output, encoding="utf-8")
    return runtime_model_bytes


def evaluate(
    primitives_path: Path,
    scores_path: Path,
    vectors_path: Path,
    corpus_path: Path,
    role_path: Path,
    ranker_path: Path,
    tracker_path: Path,
    primitive_source_path: Path,
    feature_source_path: Path,
    identity_source_path: Path,
    validate_only: bool = False,
) -> dict[str, Any]:
    primitives = json.loads(primitives_path.read_text(encoding="utf-8"))
    scores = json.loads(scores_path.read_text(encoding="utf-8"))
    vectors = json.loads(vectors_path.read_text(encoding="utf-8"))
    corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
    role_model = json.loads(role_path.read_text(encoding="utf-8"))
    ranker = json.loads(ranker_path.read_text(encoding="utf-8"))
    validate_artifact_chain(
        primitives,
        scores,
        vectors,
        corpus,
        role_model,
        ranker,
        primitives_path,
        scores_path,
        vectors_path,
        corpus_path,
        primitive_source_path,
        feature_source_path,
        identity_source_path,
    )
    entity_role_transform = validate_entity_role_transform(
        role_model.get("rankerEntityRoleTransform")
    )
    if (
        vectors.get("schemaVersion") != 6
        or ranker.get("schemaVersion") != 6
        or not isinstance(entity_role_transform, dict)
        or scores.get("rankerEntityRoleTransform") != entity_role_transform
        or vectors.get("entityRoleTransform") != entity_role_transform
        or ranker.get("provenance", {}).get("entityRoleTransform")
        != entity_role_transform
    ):
        raise ValueError("ranker entity-role transform differs across R8 artifacts")
    if (
        scores.get("decisionThreshold") != role_model.get("decisionThreshold")
        or scores.get("segmentPenalty") != role_model.get("segmentPenalty")
    ):
        raise ValueError("entity-role score policy differs from the role model")
    runtime_model_bytes = role_path.stat().st_size + ranker_path.stat().st_size
    if runtime_model_bytes > 1_048_576:
        raise ValueError("combined runtime model artifacts exceed 1 MiB before evaluation")
    seals = {
        primitives["testSealSha256"], scores["testSealSha256"],
        vectors["testSealSha256"], role_model["provenance"]["testSealSha256"],
        ranker["provenance"]["testSealSha256"],
    }
    if len(seals) != 1:
        raise ValueError("test seal differs across R6 artifacts")
    if validate_only:
        return {
            "status": "validated-only",
            "testSealSha256": next(iter(seals)),
            "entityRoleModelParametersSha256": role_parameter_sha256(role_model),
        }
    config = {
        "testSealSha256": next(iter(seals)),
        "primitiveVectorsSha256": sha256(primitives_path),
        "entityRoleScoresSha256": sha256(scores_path),
        "rankerVectorsSha256": sha256(vectors_path),
        "corpusSha256": sha256(corpus_path),
        "entityRole": {
            key: role_model[key]
            for key in ["featureVocabulary", "intercept", "coefficients", "decisionThreshold", "segmentPenalty"]
        },
        "ranker": {
            key: ranker[key]
            for key in ["featureOrder", "intercept", "coefficients", "decisionThreshold"]
        },
        "rankerSchemaVersion": ranker["schemaVersion"],
        "rankerEntityRoleTransform": entity_role_transform,
    }
    config_hash = canonical_sha256(config)
    if tracker_path.exists():
        tracker = json.loads(tracker_path.read_text(encoding="utf-8"))
        if tracker.get("configSha256") != config_hash:
            raise ValueError("sealed test already evaluated with a different configuration")
        final_bytes = apply_tracker(tracker, tracker_path, role_path, ranker_path)
        return {"status": "identical-replay", "runtimeModelBytesAfterEvaluationMetadata": final_bytes, **tracker}
    if ranker["provenance"].get("testEvaluationCount") != 0:
        raise ValueError("model claims a test evaluation without a persistent tracker")
    metrics = {
        "entityRole": span_metrics(primitives, scores, role_model, corpus),
        "ranker": ranker_metrics(vectors, ranker, corpus),
    }
    evaluation_id = f"r6-{config_hash[:16]}"
    tracker = {
        "schemaVersion": 1,
        "evaluationId": evaluation_id,
        "configSha256": config_hash,
        "testSealSha256": next(iter(seals)),
        "testEvaluationCount": 1,
        "runtimeModelBytesBeforeEvaluationMetadata": runtime_model_bytes,
        "policy": "A replay with this exact config reads this tracker; a different config is rejected.",
        "inputs": {
            "primitiveVectorsSha256": sha256(primitives_path),
            "entityRoleScoresSha256": sha256(scores_path),
            "rankerVectorsSha256": sha256(vectors_path),
            "corpusSha256": sha256(corpus_path),
        },
        "metrics": metrics,
    }
    tracker_path.parent.mkdir(parents=True, exist_ok=True)
    tracker_path.write_text(json.dumps(tracker, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    final_bytes = apply_tracker(tracker, tracker_path, role_path, ranker_path)
    return {"status": "evaluated", "runtimeModelBytesAfterEvaluationMetadata": final_bytes, **tracker}


def main() -> None:
    parser = argparse.ArgumentParser()
    script_dir = Path(__file__).parent
    parser.add_argument("--primitives", type=Path, default=script_dir / "competitor-entity-role-primitives.json")
    parser.add_argument("--scores", type=Path, default=script_dir / "competitor-entity-role-scores.json")
    parser.add_argument("--vectors", type=Path, default=script_dir / "competitor-discovery-training-vectors.json")
    parser.add_argument("--corpus", type=Path, default=script_dir / "competitor-discovery-training-corpus.json")
    parser.add_argument("--role-model", type=Path, default=script_dir.parent / "lib" / "competitor-entity-role-model.json")
    parser.add_argument("--ranker-model", type=Path, default=script_dir.parent / "lib" / "competitor-discovery-model.json")
    parser.add_argument("--tracker", type=Path, default=script_dir / "competitor-discovery-test-evaluation.json")
    parser.add_argument("--primitive-source", type=Path, default=script_dir.parent / "lib" / "competitor-discovery-primitives.ts")
    parser.add_argument("--feature-source", type=Path, default=script_dir.parent / "lib" / "competitor-discovery-features.ts")
    parser.add_argument("--identity-source", type=Path, default=script_dir.parent / "lib" / "competitor-identity.ts")
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()
    print(json.dumps(evaluate(args.primitives, args.scores, args.vectors, args.corpus, args.role_model, args.ranker_model, args.tracker, args.primitive_source, args.feature_source, args.identity_source, args.validate_only), indent=2))


if __name__ == "__main__":
    main()
