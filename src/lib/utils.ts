export function getTempColorClass(temp: number): string {
  if (temp >= 35) return 'temp-hot';
  if (temp >= 25) return 'temp-warm';
  if (temp >= 15) return 'temp-mild';
  if (temp >= 5) return 'temp-cool';
  if (temp >= -5) return 'temp-cold';
  return 'temp-freezing';
}

export function getTempBgGradient(temp: number): string {
  if (temp >= 35) return 'from-red-500 to-orange-400';
  if (temp >= 25) return 'from-orange-400 to-amber-300';
  if (temp >= 15) return 'from-amber-300 to-yellow-200';
  if (temp >= 5) return 'from-blue-300 to-cyan-200';
  if (temp >= -5) return 'from-blue-500 to-blue-300';
  return 'from-indigo-600 to-blue-500';
}

export function formatDate(dateStr: string, options?: Intl.DateTimeFormatOptions): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('tr-TR', options ?? {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('tr-TR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function formatHour(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getDayName(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);

  if (date.toDateString() === today.toDateString()) return 'Bugün';
  if (date.toDateString() === tomorrow.toDateString()) return 'Yarın';

  return date.toLocaleDateString('tr-TR', { weekday: 'long' });
}

export function getWindDirection(degrees: number): string {
  const directions = ['K', 'KD', 'D', 'GD', 'G', 'GB', 'B', 'KB'];
  const index = Math.round(degrees / 45) % 8;
  return directions[index];
}

export function getUVLevel(uv: number): { label: string; color: string } {
  if (uv <= 2) return { label: 'Düşük', color: 'text-green-500' };
  if (uv <= 5) return { label: 'Orta', color: 'text-yellow-500' };
  if (uv <= 7) return { label: 'Yüksek', color: 'text-orange-500' };
  if (uv <= 10) return { label: 'Çok Yüksek', color: 'text-red-500' };
  return { label: 'Aşırı', color: 'text-purple-500' };
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
