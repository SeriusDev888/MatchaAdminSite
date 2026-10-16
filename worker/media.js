export function detectImage(b) {
  if (b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71) return 'image/png';
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if (new TextDecoder().decode(b.slice(0, 6)).startsWith('GIF8')) return 'image/gif';
  if (
    new TextDecoder().decode(b.slice(0, 4)) === 'RIFF' &&
    new TextDecoder().decode(b.slice(8, 12)) === 'WEBP'
  )
    return 'image/webp';
  return null;
}
