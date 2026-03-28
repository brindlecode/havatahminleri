export interface WeatherInfo {
  description: string;
  icon: string;
  iconNight?: string;
}

// WMO Weather interpretation codes (WW)
// https://open-meteo.com/en/docs
export const weatherCodes: Record<number, WeatherInfo> = {
  0: { description: 'Açık', icon: 'sunny', iconNight: 'clear-night' },
  1: { description: 'Çoğunlukla Açık', icon: 'mostly-sunny', iconNight: 'mostly-clear-night' },
  2: { description: 'Parçalı Bulutlu', icon: 'partly-cloudy', iconNight: 'partly-cloudy-night' },
  3: { description: 'Bulutlu', icon: 'cloudy' },
  45: { description: 'Sisli', icon: 'fog' },
  48: { description: 'Kırağılı Sis', icon: 'fog' },
  51: { description: 'Hafif Çisenti', icon: 'drizzle' },
  53: { description: 'Orta Çisenti', icon: 'drizzle' },
  55: { description: 'Yoğun Çisenti', icon: 'drizzle' },
  56: { description: 'Dondurucu Hafif Çisenti', icon: 'freezing-drizzle' },
  57: { description: 'Dondurucu Yoğun Çisenti', icon: 'freezing-drizzle' },
  61: { description: 'Hafif Yağmur', icon: 'light-rain' },
  63: { description: 'Orta Yağmur', icon: 'rain' },
  65: { description: 'Şiddetli Yağmur', icon: 'heavy-rain' },
  66: { description: 'Dondurucu Hafif Yağmur', icon: 'freezing-rain' },
  67: { description: 'Dondurucu Şiddetli Yağmur', icon: 'freezing-rain' },
  71: { description: 'Hafif Kar', icon: 'light-snow' },
  73: { description: 'Orta Kar', icon: 'snow' },
  75: { description: 'Yoğun Kar', icon: 'heavy-snow' },
  77: { description: 'Kar Taneleri', icon: 'snow-grains' },
  80: { description: 'Hafif Sağanak', icon: 'light-rain' },
  81: { description: 'Orta Sağanak', icon: 'rain' },
  82: { description: 'Şiddetli Sağanak', icon: 'heavy-rain' },
  85: { description: 'Hafif Kar Sağanağı', icon: 'light-snow' },
  86: { description: 'Yoğun Kar Sağanağı', icon: 'heavy-snow' },
  95: { description: 'Gök Gürültülü Fırtına', icon: 'thunderstorm' },
  96: { description: 'Hafif Dolu ile Fırtına', icon: 'thunderstorm-hail' },
  99: { description: 'Şiddetli Dolu ile Fırtına', icon: 'thunderstorm-hail' },
};

export function getWeatherDescription(code: number): string {
  return weatherCodes[code]?.description ?? 'Bilinmiyor';
}

export function getWeatherIcon(code: number, isNight: boolean = false): string {
  const info = weatherCodes[code];
  if (!info) return 'unknown';
  if (isNight && info.iconNight) return info.iconNight;
  return info.icon;
}
