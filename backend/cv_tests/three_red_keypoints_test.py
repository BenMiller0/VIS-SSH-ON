"""Require three red keypoints to be visible and trackable over time."""

from __future__ import annotations

import math
from typing import Any

import vis_ssh_on as vis

EXPECTED_COUNT = 3
MIN_AREA = 10.0
MIN_MOVEMENT_PX = 8.0


def _red_candidates(sample: dict[str, Any]) -> list[dict[str, Any]]:
    keypoints = sample.get("keypoints", {})
    candidates: list[dict[str, Any]] = []

    red_value = keypoints.get("red")
    if isinstance(red_value, list):
        candidates.extend(point for point in red_value if isinstance(point, dict))

    red_points = keypoints.get("red_points") or sample.get("red_keypoints")
    if isinstance(red_points, list):
        candidates.extend(point for point in red_points if isinstance(point, dict))

    for name in ("red_1", "red_2", "red_3"):
        point = keypoints.get(name) or sample.get(name)
        if isinstance(point, dict):
            candidates.append(point)

    top_level = sample.get("keypoint", {})
    if not candidates and isinstance(top_level, dict) and top_level.get("color") == "red":
        candidates.append(top_level)

    return candidates


def _detected_red_candidates(sample: dict[str, Any]) -> list[dict[str, Any]]:
    return [point for point in _red_candidates(sample) if point.get("detected")]


def _movement(track: list[dict[str, Any]]) -> float:
    start = track[0]
    end = track[-1]
    return math.hypot(float(end["x"]) - float(start["x"]), float(end["y"]) - float(start["y"]))


def main() -> None:
    data = vis.payload()
    latest = _detected_red_candidates(data)

    if len(latest) < EXPECTED_COUNT:
        vis.fail(
            "expected three red keypoints, but the current payload does not expose them",
            expected_count=EXPECTED_COUNT,
            observed_count=len(latest),
            note="The built-in detector currently reports only the largest red blob unless multi-red payloads are added.",
        )

    selected = latest[:EXPECTED_COUNT]
    for index, point in enumerate(selected, start=1):
        area = float(point.get("area") or 0.0)
        if area < MIN_AREA:
            vis.fail(
                f"red_{index} keypoint area was too small",
                expected_min_area=MIN_AREA,
                observed_area=area,
            )

    tracks: list[list[dict[str, Any]]] = [[] for _ in range(EXPECTED_COUNT)]
    for sample in data.get("history", []):
        if not isinstance(sample, dict):
            continue
        points = _detected_red_candidates(sample)
        for index, point in enumerate(points[:EXPECTED_COUNT]):
            tracks[index].append(point)

    for index, track in enumerate(tracks, start=1):
        if len(track) < 2:
            vis.fail(f"red_{index} keypoint needs at least two detected samples", samples=len(track))

        distance = _movement(track)
        if distance < MIN_MOVEMENT_PX:
            vis.fail(
                f"red_{index} keypoint did not move enough",
                expected_min_distance=MIN_MOVEMENT_PX,
                observed_distance=round(distance, 2),
            )

    vis.pass_test(
        red_keypoint_count=EXPECTED_COUNT,
        coordinates=[
            {"x": point.get("x"), "y": point.get("y"), "area": point.get("area")}
            for point in selected
        ],
        samples=[len(track) for track in tracks],
    )


if __name__ == "__main__":
    main()
