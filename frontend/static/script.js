let wsCamera, wsThermal, wsTest;
let currentPixels = [];
let currentRunId = null;

const protocol = location.protocol === "https:" ? "wss" : "ws";

function updateUI(data) {}

function renderTest(data) {
    const testStatus  = document.getElementById("test-status");
    const testMetrics = document.getElementById("test-metrics");

    if (data.type === "start") {
        currentRunId = data.run_id;
        document.getElementById("stop-btn").style.display = "inline";
        testStatus.textContent = "RUNNING...";
        testStatus.className   = "running";
        testMetrics.innerHTML  = "";
    }

    if (data.type === "metric") {
        testMetrics.innerHTML = `
            Temp: ${data.temperature}°C<br>
            Pixel Changed: ${data.pixel_changed}
        `;
    }

    if (data.type === "result") {
        document.getElementById("stop-btn").style.display = "none";
        currentRunId = null;

        testStatus.textContent = data.status === "killed" ? "STOPPED" : data.status.toUpperCase();
        testStatus.className   = data.status;

        if (data.status === "fail") {
            const t = data.thresholds;
            let detail = `<br>Reason: ${data.failure_reason}`;
            if (t) {
                detail += `<br><span class="failure-detail">` +
                    `Thresholds — Max Temp: ${t.max_temp}°C | ` +
                    `Require Pixel Change: ${t.require_pixel_change}` +
                    `</span>`;
            }
            testMetrics.innerHTML += detail;
        }
    }
}

function connectTest() {
    wsTest = new WebSocket(`${protocol}://${window.location.host}/ws/test`);

    wsTest.onopen  = () => console.log("Test WS connected");
    wsTest.onclose = () => {
        console.log("Test WS disconnected");
        setTimeout(connectTest, 1000);
    };
    wsTest.onmessage = (event) => {
        try {
            renderTest(JSON.parse(event.data));
        } catch (err) {
            console.error("Test error:", err);
        }
    };
}

function renderHeatmap(pixels) {
    const canvas   = document.getElementById('heatmap');
    const ctx      = canvas.getContext('2d');
    const cellSize = canvas.width / 8;
    const minTemp  = Math.min(...pixels);
    const maxTemp  = Math.max(...pixels);
    const range    = maxTemp - minTemp || 1;

    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const temp = pixels[row * 8 + col];
            const norm = (temp - minTemp) / range;
            const r    = Math.floor(255 * Math.min(1, norm * 2));
            const g    = Math.floor(255 * Math.max(0, (norm - 0.5) * 2));
            const b    = Math.floor(255 * (1 - norm));
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
        }
    }
}

function connectThermal() {
    wsThermal = new WebSocket(`${protocol}://${window.location.host}/ws/thermal`);

    wsThermal.onopen  = () => console.log("Thermal WS connected");
    wsThermal.onclose = () => {
        console.log("Thermal WS disconnected");
        setTimeout(connectThermal, 1000);
    };
    wsThermal.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            currentPixels = data.pixels.flat();
            renderHeatmap(currentPixels);
        } catch (err) {
            console.error("Thermal error:", err);
        }
    };
}

function renderCamera(data) {
    const image     = document.getElementById("image");
    const objectURL = URL.createObjectURL(data);
    image.onload = () => {
        URL.revokeObjectURL(objectURL);
        image.classList.add("loaded");
    };
    image.src = objectURL;
}

function connectCamera() {
    wsCamera = new WebSocket(`${protocol}://${window.location.host}/ws`);
    wsCamera.binaryType = "blob";

    wsCamera.onopen  = () => {
        console.log("Camera WS connected");
        setStatus('Connected', true);
    };
    wsCamera.onclose = () => {
        console.log("Camera WS disconnected");
        setStatus('Disconnected', false);
        setTimeout(connectCamera, 1000);
    };
    wsCamera.onmessage = (event) => {
        try {
            renderCamera(event.data);
        } catch (err) {
            console.error("Camera error:", err);
        }
    };
}

function setStatus(text, connected) {
    const statusEl    = document.getElementById('status');
    statusEl.textContent = text;
    statusEl.className   = connected ? 'connected' : 'disconnected';
}

async function startTest() {
    const name               = document.getElementById("test-name").value.trim() || "Unnamed Test";
    const enableThermal      = document.getElementById("enable-thermal").checked;
    const maxTemp            = parseInt(document.getElementById("max-temp").value, 10);
    const requirePixelChange = document.getElementById("require-pixel-change").checked;
    const durationRaw        = parseInt(document.getElementById("test-duration").value, 10);
    const duration           = durationRaw > 0 ? durationRaw : null;

    const configRes = await fetch("/api/configs", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
            name,
            type: enableThermal ? "thermal" : "custom",
            parameters: {
                max_temp:             String(maxTemp),
                require_pixel_change: String(requirePixelChange),
            },
        }),
    });
    const config = await configRes.json();

    document.getElementById("test-modal").style.display = "none";

    // Don't await — the response only arrives after the test finishes.
    // run_id and stop-btn are handled in renderTest() via the WS start event.
    fetch(`/api/tests/${config.id}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ duration }),
    });
}

async function stopTest() {
    if (!currentRunId) return;
    await fetch(`/api/tests/${currentRunId}/stop`, { method: "POST" });
}

document.addEventListener('DOMContentLoaded', () => {
    connectCamera();
    connectThermal();
    connectTest();

    document.getElementById("run-test-btn").addEventListener("click", () => {
        document.getElementById("test-modal").style.display = "flex";
    });

    document.getElementById("close-test-modal").addEventListener("click", () => {
        document.getElementById("test-modal").style.display = "none";
    });

    document.getElementById("enable-thermal").addEventListener("change", (e) => {
        document.getElementById("thermal-options").style.display = e.target.checked ? "block" : "none";
    });

    document.getElementById("start-test-btn").addEventListener("click", startTest);
    document.getElementById("stop-btn").addEventListener("click", stopTest);
});
