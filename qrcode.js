/* =================================================================
   SolarQuest — qrcode.js
   QR code generation (host's pairing code) and camera scanning
   (joining player). Uses the `qrcodejs` and `jsQR` libraries loaded
   via CDN in index.html.
   ================================================================= */

// Render a scannable QR code that deep-links straight into the game.
function renderQR(containerId, text) {
  const box = document.getElementById(containerId);
  box.innerHTML = ""; // clear any QR from a previous game
  if (typeof QRCode === "undefined") return; // library failed to load — pairing code still works manually
  new QRCode(box, {
    text,
    width: 180,
    height: 180,
    colorDark: "#201a3e",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.M
  });
}

/* =================================================================
   Camera scanning — reads frames from the device camera and looks
   for a QR code with jsQR. Works on mobile browsers (uses the
   rear camera by default via facingMode: "environment").
   ================================================================= */
let scanStream = null;
let scanRAF = null;

function extractCode(scannedText) {
  try {
    const url = new URL(scannedText);
    const code = url.searchParams.get("join");
    if (code) return code.toUpperCase();
  } catch (e) {
    // Not a URL — maybe the raw 6-char code was encoded directly.
  }
  const trimmed = scannedText.trim().toUpperCase();
  return trimmed.length === 6 ? trimmed : null;
}

async function startScanner(videoElId, canvasElId, onCode) {
  const video = document.getElementById(videoElId);
  const canvas = document.getElementById(canvasElId);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  try {
    scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" }
    });
  } catch (err) {
    document.getElementById("mp-join-error").textContent =
      "Couldn't access the camera. Check permissions, or type the code instead.";
    return;
  }

  video.srcObject = scanStream;
  video.setAttribute("playsinline", "true");
  await video.play();

  const tick = () => {
    if (!scanStream) return; // stopped
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = typeof jsQR !== "undefined"
        ? jsQR(imageData.data, imageData.width, imageData.height)
        : null;
      if (result && result.data) {
        const code = extractCode(result.data);
        if (code) {
          stopScanner();
          onCode(code);
          return;
        }
      }
    }
    scanRAF = requestAnimationFrame(tick);
  };
  scanRAF = requestAnimationFrame(tick);
}

function stopScanner() {
  if (scanRAF) cancelAnimationFrame(scanRAF);
  scanRAF = null;
  if (scanStream) {
    scanStream.getTracks().forEach(t => t.stop());
    scanStream = null;
  }
}

window.SQQRCode = { renderQR, startScanner, stopScanner };
