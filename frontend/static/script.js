let wsCamera, wsThermal, wsTest;
let currentPixels = [];

const protocol = location.protocol === "https:" ? "wss" : "ws";

function updateUI(data) {

}

function renderTest(data) {
    const testStatus = document.getElementById("test-status");
    const testMetrics = document.getElementById("test-metrics");

    if (data.type === "start") {
        testStatus.textContent = "RUNNING...";
        testStatus.className = "running";
        testMetrics.innerHTML = "";
    }

    if (data.type === "metric") {
        testMetrics.innerHTML = `
                    Temp: ${data.temperature}°C<br>
                    Pixel Changed: ${data.pixel_changed}
                `;
    }

    if (data.type === "result") {
        testStatus.textContent = data.status.toUpperCase();
        testStatus.className = data.status;

        if (data.status === "fail") {
            testMetrics.innerHTML += `<br>Reason: ${data.failure_reason}`;
        }
    }
}

function connectTest() {
    wsTest = new WebSocket(`${protocol}://${window.location.host}/ws/test`);

    wsTest.onopen = () => {
        console.log("Test WS connected");
    };

    wsTest.onclose = () => {
        console.log("Test WS disconnected");
        setTimeout(connectTest, 1000);
    };

    wsTest.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            renderTest(data);
        } catch (err) {
            console.error("Test error:", err);
        }
    };
}

function renderHeatmap(pixels) {
    const canvas = document.getElementById('heatmap');
    const ctx = canvas.getContext('2d');
    const cellSize = canvas.width / 8;

    const minTemp = Math.min(...pixels);
    const maxTemp = Math.max(...pixels);
    const range = maxTemp - minTemp || 1;

    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const temp = pixels[row * 8 + col];
            const norm = (temp - minTemp) / range;
            const r = Math.floor(255 * Math.min(1, norm * 2));
            const g = Math.floor(255 * Math.max(0, (norm - 0.5) * 2));
            const b = Math.floor(255 * (1 - norm));
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
        }
    }
}

function connectThermal() {
    wsThermal = new WebSocket(`${protocol}://${window.location.host}/ws/thermal`);

    wsThermal.onopen = () => {
        console.log("Thermal WS connected");
    };

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
    const image = document.getElementById("image");
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

    wsCamera.onopen = () => {
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
            const data = event.data;
            renderCamera(data);
        } catch (err) {
            console.error("Camera error:", err);
        }
    };
}

function setStatus(text, connected) {
    const statusEl = document.getElementById('status');
    statusEl.textContent = text;
    statusEl.className = connected ? 'connected' : 'disconnected';
}

function sendCommand(id) {
    fetch(`/api/tests/${id}`, {
        method: "POST"
    })
        .then(res => res.json())
        .then(data => console.log("Test started:", data.run_id))
        .catch(err => console.error("Command error:", err));
}

document.addEventListener('DOMContentLoaded', () => {
    connectCamera();
    connectThermal();
    connectTest();
});