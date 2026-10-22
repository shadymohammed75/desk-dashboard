// Builds an ESP Web Tools manifest in memory from a locally chosen .bin, so the firmware (which contains
// Wi-Fi credentials and the device token) is never served by the Worker.
const input = document.getElementById("bin");
const label = document.getElementById("file-label");
const status = document.getElementById("file-status");
const install = document.getElementById("install");
const button = document.getElementById("install-btn");

let urls = [];

function setStatus(text, cls) {
  status.textContent = text;
  status.className = `small ${cls || ""}`;
}

input.addEventListener("change", async () => {
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls = [];
  button.disabled = true;
  const file = input.files && input.files[0];
  if (!file) return;
  label.textContent = file.name;

  const head = new Uint8Array(await file.slice(0, 1).arrayBuffer());
  if (file.size < 64 * 1024 || file.size > 16 * 1024 * 1024 || head[0] !== 0xe9) {
    setStatus("That doesn't look like a merged ESP32 image (expected firmware-merged.bin).", "warn");
    return;
  }
  const bin = URL.createObjectURL(file);
  const manifest = {
    name: "Desk Health Dashboard",
    version: file.name,
    new_install_prompt_erase: true,
    builds: [{ chipFamily: "ESP32-S3", parts: [{ path: bin, offset: 0 }] }],
  };
  const manifestUrl = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: "application/json" }));
  urls = [bin, manifestUrl];
  install.setAttribute("manifest", manifestUrl);
  button.disabled = false;
  setStatus(`Ready: ${(file.size / 1024 / 1024).toFixed(2)} MB. Now connect the board.`, "ok");
});
