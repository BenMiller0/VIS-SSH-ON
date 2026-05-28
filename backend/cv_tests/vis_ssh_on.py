"""Tiny public API for editable VIS-SSH-ON CV tests.

Example:

    import vis_ssh_on as vis

    red = vis.keypoint("red").should_be_visible()
    red.should_rotate("clockwise")
    vis.pass_test(x=red.x, y=red.y)

    red_points = vis.keypoints("red", count=3).should_be_visible()
    vis.pass_test(red_keypoint_count=len(red_points))
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from _helpers import (
    detected_points,
    fail,
    load_payload,
    pass_test,
    require_keypoint,
    rotation_direction,
)

_PAYLOAD: dict[str, Any] | None = None


def payload() -> dict[str, Any]:
    """Return the runner payload once per script."""
    global _PAYLOAD
    if _PAYLOAD is None:
        _PAYLOAD = load_payload()
    return _PAYLOAD


def keypoint(name: str = "red") -> "Keypoint":
    """Declare a keypoint to test.

    The runner provides built-in ``red`` and ``green`` keypoints. The API also
    accepts named payloads shaped like {"keypoints": {"tip": {...}}}, so future
    detectors and custom runners can expose multiple points without changing
    user tests.
    """
    return scene().keypoint(name)


def keypoints(name: str = "red", *, count: int = 1) -> "KeypointGroup":
    """Declare a group of same-color keypoints to test."""
    return scene().keypoints(name, count=count)


def scene(data: dict[str, Any] | None = None) -> "Scene":
    return Scene(data or payload())


def _sample_keypoint(sample: dict[str, Any], name: str) -> dict[str, Any]:
    if "keypoints" in sample and isinstance(sample["keypoints"], dict):
        return sample["keypoints"].get(name, {})
    value = sample.get(name, sample)
    return value if isinstance(value, dict) else {}


def _as_point_list(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return [point for point in value if isinstance(point, dict)]
    if isinstance(value, dict):
        return [value]
    return []


def _sample_keypoints(sample: dict[str, Any], name: str) -> list[dict[str, Any]]:
    keypoints = sample.get("keypoints", {})
    candidates: list[dict[str, Any]] = []

    if isinstance(keypoints, dict):
        plural_points = _as_point_list(keypoints.get(f"{name}_points"))
        candidates.extend(plural_points)

        named_value = keypoints.get(name)
        if isinstance(named_value, list) or not plural_points:
            candidates.extend(_as_point_list(named_value))

        index = 1
        while True:
            point = keypoints.get(f"{name}_{index}")
            if not isinstance(point, dict):
                break
            candidates.append(point)
            index += 1

    candidates.extend(_as_point_list(sample.get(f"{name}_points")))
    candidates.extend(_as_point_list(sample.get(f"{name}_keypoints")))

    if not candidates:
        top_level = sample.get("keypoint", {})
        if isinstance(top_level, dict) and (top_level.get("name") == name or top_level.get("color") == name):
            candidates.append(top_level)

    seen: set[tuple[Any, Any, Any]] = set()
    unique: list[dict[str, Any]] = []
    for point in candidates:
        marker = (point.get("name"), point.get("x"), point.get("y"))
        if marker in seen:
            continue
        seen.add(marker)
        unique.append(point)
    return unique


@dataclass
class Scene:
    data: dict[str, Any]

    def keypoint(self, name: str = "red") -> "Keypoint":
        lookup_name = "red" if name in {"red_blob", "blob"} else name
        keypoints = self.data.get("keypoints", {})
        history = self.data.get("history", [])

        latest = keypoints.get(lookup_name, {})
        top_level = self.data.get("keypoint", {})
        if not latest and (top_level.get("name") == lookup_name or top_level.get("color") == lookup_name):
            latest = top_level
        if not latest and lookup_name == "red":
            latest = top_level

        samples = [
            point
            for sample in history
            if isinstance(sample, dict)
            for point in [_sample_keypoint(sample, lookup_name)]
            if point.get("detected")
        ]
        if not samples and lookup_name == "red":
            samples = detected_points(self.data)
        elif latest.get("detected"):
            samples.append(latest)

        return Keypoint(name=name, latest=latest, samples=samples)

    def keypoints(self, name: str = "red", *, count: int = 1) -> "KeypointGroup":
        if count < 1:
            fail("keypoint count must be at least 1", observed_count=count)

        lookup_name = "red" if name in {"red_blob", "blob"} else name
        tracks: list[list[dict[str, Any]]] = [[] for _ in range(count)]
        for sample in self.data.get("history", []):
            if not isinstance(sample, dict):
                continue
            points = [
                point
                for point in _sample_keypoints(sample, lookup_name)
                if point.get("detected")
            ][:count]
            for index, point in enumerate(points):
                tracks[index].append(point)

        latest = [
            point
            for point in _sample_keypoints(self.data, lookup_name)
            if point.get("detected")
        ][:count]
        for index, point in enumerate(latest):
            tracks[index].append(point)

        points = [
            Keypoint(
                name=(track[-1].get("name") if track else None) or f"{name}_{index + 1}",
                latest=track[-1] if track else {},
                samples=tracks[index],
            )
            for index, track in enumerate(tracks)
        ]

        return KeypointGroup(name=name, expected_count=count, points=points)


@dataclass
class KeypointGroup:
    name: str
    expected_count: int
    points: list["Keypoint"]

    def __iter__(self):
        return iter(self.points)

    def __len__(self) -> int:
        return len([point for point in self.points if point.detected])

    def __getitem__(self, index: int) -> "Keypoint":
        return self.points[index]

    @property
    def detected(self) -> list["Keypoint"]:
        return [point for point in self.points if point.detected]

    @property
    def coordinates(self) -> list[dict[str, float | None]]:
        return [point.coordinates for point in self.detected]

    @property
    def areas(self) -> list[float]:
        return [point.area for point in self.detected]

    def should_be_visible(self, *, min_area: float | None = None) -> "KeypointGroup":
        observed = len(self)
        if observed < self.expected_count:
            fail(
                f"expected {self.expected_count} {self.name} keypoints",
                expected_count=self.expected_count,
                observed_count=observed,
            )

        for point in self.points[:self.expected_count]:
            point.should_be_visible(min_area=min_area)
        return self

    def should_have_moved(self, *, at_least: float = 8.0) -> "KeypointGroup":
        self.should_be_visible()
        for point in self.points[:self.expected_count]:
            point.should_have_moved(at_least=at_least)
        return self


@dataclass
class Keypoint:
    name: str
    latest: dict[str, Any]
    samples: list[dict[str, Any]]

    @property
    def detected(self) -> bool:
        return bool(self.latest.get("detected"))

    @property
    def x(self) -> float | None:
        return self.latest.get("x")

    @property
    def y(self) -> float | None:
        return self.latest.get("y")

    @property
    def area(self) -> float:
        return float(self.latest.get("area") or 0.0)

    @property
    def coordinates(self) -> dict[str, float | None]:
        return {"x": self.x, "y": self.y}

    def should_be_visible(self, *, min_area: float | None = None) -> "Keypoint":
        if not self.detected:
            fail(f"{self.name} keypoint was not detected")
        if min_area is not None and self.area < min_area:
            fail(
                f"{self.name} keypoint area was too small",
                expected_min_area=min_area,
                observed_area=self.area,
            )
        return self

    def should_be_inside(
        self,
        *,
        x: tuple[float, float] | None = None,
        y: tuple[float, float] | None = None,
    ) -> "Keypoint":
        self.should_be_visible()
        if x is not None and not (x[0] <= self.x <= x[1]):
            fail(f"{self.name} keypoint x was outside range", expected_x=x, observed_x=self.x)
        if y is not None and not (y[0] <= self.y <= y[1]):
            fail(f"{self.name} keypoint y was outside range", expected_y=y, observed_y=self.y)
        return self

    def should_have_moved(self, *, at_least: float = 8.0) -> "Keypoint":
        if len(self.samples) < 2:
            fail(f"{self.name} keypoint needs at least two detected samples", samples=len(self.samples))

        distance = max(
            math.hypot(float(end["x"]) - float(start["x"]), float(end["y"]) - float(start["y"]))
            for start_index, start in enumerate(self.samples)
            for end in self.samples[start_index + 1:]
        )
        if distance < at_least:
            fail(
                f"{self.name} keypoint did not move enough",
                expected_min_distance=at_least,
                observed_distance=round(distance, 2),
            )
        return self

    def should_be_left_of(self, other: "Keypoint", *, by_at_least: float = 0.0) -> "Keypoint":
        self._should_compare(other, "left of", by_at_least, lambda a, b: b.x - a.x)
        return self

    def should_be_right_of(self, other: "Keypoint", *, by_at_least: float = 0.0) -> "Keypoint":
        self._should_compare(other, "right of", by_at_least, lambda a, b: a.x - b.x)
        return self

    def should_be_above(self, other: "Keypoint", *, by_at_least: float = 0.0) -> "Keypoint":
        self._should_compare(other, "above", by_at_least, lambda a, b: b.y - a.y)
        return self

    def should_be_below(self, other: "Keypoint", *, by_at_least: float = 0.0) -> "Keypoint":
        self._should_compare(other, "below", by_at_least, lambda a, b: a.y - b.y)
        return self

    def should_be_near(self, other: "Keypoint", *, within: float) -> "Keypoint":
        distance = self.distance_to(other)
        if distance > within:
            fail(
                f"{self.name} keypoint was too far from {other.name}",
                expected_max_distance=within,
                observed_distance=round(distance, 2),
            )
        return self

    def distance_to(self, other: "Keypoint") -> float:
        self.should_be_visible()
        other.should_be_visible()
        return math.hypot(float(self.x) - float(other.x), float(self.y) - float(other.y))

    def should_rotate(self, direction: str, *, min_degrees: float = 8.0) -> "Keypoint":
        observed, degrees = self.rotation(min_degrees=min_degrees)
        if observed != direction:
            fail(
                f"{self.name} keypoint rotated {observed}, expected {direction}",
                expected=direction,
                observed=observed,
                delta_degrees=degrees,
                samples=len(self.samples),
            )
        return self

    def rotation(self, *, min_degrees: float = 8.0) -> tuple[str, float]:
        if len(self.samples) < 2:
            fail(f"{self.name} keypoint needs at least two detected samples", samples=len(self.samples))

        width = next((p.get("frame_width") for p in self.samples if p.get("frame_width")), None)
        height = next((p.get("frame_height") for p in self.samples if p.get("frame_height")), None)
        if not width or not height:
            fail("frame size unavailable")

        center_x = width / 2
        center_y = height / 2
        previous = math.atan2(self.samples[0]["y"] - center_y, self.samples[0]["x"] - center_x)
        total_delta = 0.0

        for point in self.samples[1:]:
            current = math.atan2(point["y"] - center_y, point["x"] - center_x)
            delta = current - previous
            while delta > math.pi:
                delta -= 2 * math.pi
            while delta < -math.pi:
                delta += 2 * math.pi
            total_delta += delta
            previous = current

        degrees = round(math.degrees(total_delta), 2)
        if abs(degrees) < min_degrees:
            fail(
                f"{self.name} keypoint did not rotate enough",
                expected_min_degrees=min_degrees,
                observed_degrees=degrees,
                samples=len(self.samples),
            )

        return ("clockwise" if total_delta > 0 else "counterclockwise"), degrees

    def _should_compare(self, other: "Keypoint", relation: str, minimum: float, delta_fn) -> None:
        self.should_be_visible()
        other.should_be_visible()
        delta = float(delta_fn(self, other))
        if delta < minimum:
            fail(
                f"{self.name} keypoint was not {relation} {other.name}",
                expected_min_delta=minimum,
                observed_delta=round(delta, 2),
            )


__all__ = [
    "Keypoint",
    "KeypointGroup",
    "Scene",
    "detected_points",
    "fail",
    "keypoint",
    "keypoints",
    "load_payload",
    "pass_test",
    "payload",
    "require_keypoint",
    "rotation_direction",
    "scene",
]
