"""Print the current red keypoint coordinates."""

from vis_ssh_on import fail, load_payload, pass_test


def main() -> None:
    payload = load_payload()
    keypoint = payload.get("keypoint", {})
    if not keypoint.get("detected"):
        print("red keypoint not detected")
        fail("red keypoint not detected")

    print(f"x={keypoint['x']} y={keypoint['y']} area={keypoint.get('area')}")
    pass_test(
        x=keypoint["x"],
        y=keypoint["y"],
        area=keypoint.get("area"),
    )


if __name__ == "__main__":
    main()
