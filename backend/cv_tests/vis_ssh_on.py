"""Tiny public API for editable VIS-SSH-ON CV tests.

Example:

    import vis_ssh_on as vis

    red = vis.keypoint("red").should_be_visible()
    red.should_rotate("clockwise")
    vis.pass_test(x=red.x, y=red.y)
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


def scene(data: dict[str, Any] | None = None) -> "Scene":
    return Scene(data or payload())


def _sample_keypoint(sample: dict[str, Any], name: str) -> dict[str, Any]:
    if "keypoints" in sample and isinstance(sample["keypoints"], dict):
        return sample["keypoints"].get(name, {})
    value = sample.get(name, sample)
    return value if isinstance(value, dict) else {}


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

        start = self.samples[0]
        end = self.samples[-1]
        distance = math.hypot(float(end["x"]) - float(start["x"]), float(end["y"]) - float(start["y"]))
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
    "Scene",
    "detected_points",
    "fail",
    "keypoint",
    "load_payload",
    "pass_test",
    "payload",
    "require_keypoint",
    "rotation_direction",
    "scene",
]
