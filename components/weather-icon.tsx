// components/weather-icon.tsx
//
// v3 FIX (2026-08-24): SVG weather icons umjesto Unicode emoji.
// Unicode emoji (☀️ ⛅ ☁️ 🌧️ ❄️ ⛈️ 🌡️) zahtijevaju color emoji font
// na sistemu (npr. Segoe UI Emoji na Windows). Na Windows mini-PC
// kiosk uređajima bez tog fonta prikazuju se kao prazna kockica (tofu)
// ili uopšte ne prikazuju. SVG path-ovi su font-independent i
// garantovano se renderuju identično svuda.
//
// Komponenta prikazuje ikonu + temperaturu. Ako je code null, prikazuje
// samo "--°" (bez ikone).

import React, { type ReactElement } from 'react';

interface WeatherIconProps {
  code: number | null;
  temperature?: number | null;
  size?: number;
  textSize?: number;
  showText?: boolean;
  className?: string;
}

const WeatherIcons = {
  clear: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="12" r="5" fill="#FBBF24" />
      <circle cx="12" cy="12" r="4" fill="#F59E0B" />
    </svg>
  ),
  partlyCloudy: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="12" r="5" fill="#FBBF24" />
      <circle cx="12" cy="12" r="4" fill="#F59E0B" />
      <path d="M18 14a4 4 0 100-8 4 4 0 000 8z" fill="#9CA3AF" opacity="0.7" />
    </svg>
  ),
  cloudy: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 15a4 4 0 100-8 4 4 0 000 8z" fill="#9CA3AF" />
      <path d="M16 17a4 4 0 100-8 4 4 0 000 8z" fill="#6B7280" opacity="0.8" />
    </svg>
  ),
  overcast: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 16a4 4 0 100-8 4 4 0 000 8z" fill="#6B7280" />
      <path d="M16 18a4 4 0 100-8 4 4 0 000 8z" fill="#4B5563" opacity="0.9" />
      <path d="M12 16a4 4 0 100-8 4 4 0 000 8z" fill="#374151" opacity="0.7" />
    </svg>
  ),
  fog: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 12h16M4 14h16M4 16h16" stroke="currentColor" strokeWidth="2" fill="none" />
      <path d="M4 10h16" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  ),
  drizzle: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 16a4 4 0 100-8 4 4 0 000 8z" fill="#93C5FD" />
      <path d="M16 18a4 4 0 100-8 4 4 0 000 8z" fill="#60A5FA" opacity="0.8" />
      <path d="M6 20l2-4M10 20l1-2M14 20l2-4" stroke="#3B82F6" strokeWidth="1.5" fill="none" />
    </svg>
  ),
  rain: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 16a4 4 0 100-8 4 4 0 000 8z" fill="#60A5FA" />
      <path d="M16 18a4 4 0 100-8 4 4 0 000 8z" fill="#3B82F6" opacity="0.9" />
      <path d="M6 20l2-4M10 20l1-2M14 20l2-4M18 20l1-2" stroke="#1D4ED8" strokeWidth="2" fill="none" />
    </svg>
  ),
  snow: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 16a4 4 0 100-8 4 4 0 000 8z" fill="#E0F2FE" />
      <path d="M16 18a4 4 0 100-8 4 4 0 000 8z" fill="#BAE6FD" opacity="0.9" />
      <path d="M6 18l1-1M6 22l1-1M10 18l1-1M10 22l1-1M14 18l1-1M14 22l1-1M18 18l1-1M18 22l1-1"
        stroke="#0EA5E9" strokeWidth="1.5" fill="none" />
    </svg>
  ),
  thunderstorm: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 16a4 4 0 100-8 4 4 0 000 8z" fill="#4B5563" />
      <path d="M16 18a4 4 0 100-8 4 4 0 000 8z" fill="#374151" opacity="0.9" />
      <path d="M10 12l-2 4h3l-2 4 5-6h-3l2-4-4 2z" fill="#F59E0B" />
    </svg>
  ),
  unknown: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1" fill="none" />
      <text x="12" y="16" textAnchor="middle" fontSize="12" fill="currentColor">?</text>
    </svg>
  ),
};

// WMO Weather interpretation codes (WW) → SVG icon
function getWeatherInfo(code: number | null): { icon: ReactElement; description: string } {
  if (code === null) return { icon: WeatherIcons.unknown, description: 'Nepoznato' };

  if (code === 0) return { icon: WeatherIcons.clear, description: 'Vedro' };
  if (code === 1 || code === 2) return { icon: WeatherIcons.partlyCloudy, description: 'Djelomično oblačno' };
  if (code === 3) return { icon: WeatherIcons.overcast, description: 'Oblačno' };
  if (code === 45 || code === 48) return { icon: WeatherIcons.fog, description: 'Magla' };
  if (code >= 51 && code <= 55) return { icon: WeatherIcons.drizzle, description: 'Kiša' };
  if (code >= 61 && code <= 65) return { icon: WeatherIcons.rain, description: 'Kiša' };
  if (code === 66 || code === 67) return { icon: WeatherIcons.rain, description: 'Smrzavajuća kiša' };
  if (code >= 71 && code <= 77) return { icon: WeatherIcons.snow, description: 'Snijeg' };
  if (code >= 80 && code <= 82) return { icon: WeatherIcons.rain, description: 'Pljuskovi' };
  if (code >= 85 && code <= 86) return { icon: WeatherIcons.snow, description: 'Sniježni pljuskovi' };
  if (code >= 95 && code <= 99) return { icon: WeatherIcons.thunderstorm, description: 'Grmljavina' };
  return { icon: WeatherIcons.unknown, description: 'Nepoznato' };
}

const WeatherIcon: React.FC<WeatherIconProps> = ({
  code,
  temperature,
  size = 20,
  textSize = 14,
  showText = false,
  className = '',
}) => {
  const { icon, description } = getWeatherInfo(code);
  const roundedTemp = temperature !== null && temperature !== undefined ? Math.round(temperature) : null;

  return (
    <div
      className={`flex items-center gap-1 bg-black/20 rounded-lg px-2 py-1 border border-white/20 backdrop-blur-sm ${className}`}
      title={`${description}${roundedTemp !== null ? `, ${roundedTemp}°C` : ''}`}
    >
      <div
        style={{ width: `${size}px`, height: `${size}px` }}
      >
        {icon}
      </div>
      {roundedTemp !== null && (
        <span
          style={{ fontSize: `${textSize}px` }}
          className="text-white font-bold whitespace-nowrap drop-shadow-sm"
        >
          {roundedTemp}°
        </span>
      )}
      {showText && (
        <span
          style={{ fontSize: `${textSize - 2}px` }}
          className="text-white opacity-80 hidden lg:block ml-1"
        >
          {description}
        </span>
      )}
    </div>
  );
};

export default WeatherIcon;
