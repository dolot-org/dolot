function canvasSignature() {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 190;
    canvas.height = 44;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.fillStyle = '#2947d1';
    ctx.fillRect(4, 7, 62, 28);
    ctx.font = '17px Arial, sans-serif';
    ctx.fillStyle = '#f2c230';
    ctx.fillText('Dotlo Åé中 0123456789', 7, 23);
    ctx.font = '13px serif';
    ctx.fillStyle = '#121629';
    ctx.fillText('Dns @ example', 30, 35);
    return canvas.toDataURL();
  } catch {
    return '';
  }
}

export async function deviceFingerprint() {
  const { deviceMemory } = navigator as Navigator & { deviceMemory?: number };
  const screenSize = [screen.width, screen.height].sort((a, b) => a - b);
  const signals = JSON.stringify([
    'dotlo-device-v1', navigator.platform, navigator.hardwareConcurrency, deviceMemory ?? null,
    navigator.maxTouchPoints, screenSize, screen.colorDepth, canvasSignature(),
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signals));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
