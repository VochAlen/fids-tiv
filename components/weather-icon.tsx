// components/weather-icon.tsx
import React, { JSX } from 'react';

interface WeatherIconProps {
  code: number;
  temperature: number;
  size?: number;
  textSize?: number;
  showText?: boolean;
}

// SVG Weather Icons
const WeatherIcons = {
  clear: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="12" r="5" fill="#FBBF24"/>
      <circle cx="12" cy="12" r="4" fill="#F59E0B"/>
    </svg>
  ),
  partlyCloudy: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="12" r="5" fill="#FBBF24"/>
      <circle cx="12" cy="12" r="4" fill="#F59E0B"/>
      <path d="M18 14a4 4 0 100-8 4 4 0 000 8z" fill="#9CA3AF" opacity="0.7"/>
    </svg>
  ),
  cloudy: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 15a4 4 0 100-8 4 4 0 000 8z" fill="#9CA3AF"/>
      <path d="M16 17a4 4 0 100-8 4 4 0 000 8z" fill="#6B7280" opacity="0.8"/>
    </svg>
  ),
  overcast: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 16a4 4 0 100-8 4 4 0 000 8z" fill="#6B7280"/>
      <path d="M16 18a4 4 0 100-8 4 4 0 000 8z" fill="#4B5563" opacity="0.9"/>
      <path d="M12 16a4 4 0 100-8 4 4 0 000 8z" fill="#374151" opacity="0.7"/>
    </svg>
  ),
  fog: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 12h16M4 14h16M4 16h16" stroke="currentColor" strokeWidth="2" fill="none"/>
      <path d="M4 10h16" stroke="currentColor" strokeWidth="1" fill="none"/>
    </svg>
  ),
  drizzle: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 16a4 4 0 100-8 4 4 0 000 8z" fill="#93C5FD"/>
      <path d="M16 18a4 4 0 100-8 4 4 0 000 8z" fill="#60A5FA" opacity="0.8"/>
      <path d="M6 20l2-4M10 20l1-2M14 20l2-4" stroke="#3B82F6" strokeWidth="1.5" fill="none"/>
    </svg>
  ),
  rain: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 16a4 4 0 100-8 4 4 0 000 8z" fill="#60A5FA"/>
      <path d="M16 18a4 4 0 100-8 4 4 0 000 8z" fill="#3B82F6" opacity="0.9"/>
      <path d="M6 20l2-4M10 20l1-2M14 20l2-4M18 20l1-2" stroke="#1D4ED8" strokeWidth="2" fill="none"/>
    </svg>
  ),
  snow: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 16a4 4 0 100-8 4 4 0 000 8z" fill="#E0F2FE"/>
      <path d="M16 18a4 4 0 100-8 4 4 0 000 8z" fill="#BAE6FD" opacity="0.9"/>
      <path d="M6 18l1-1M6 22l1-1M10 18l1-1M10 22l1-1M14 18l1-1M14 22l1-1M18 18l1-1M18 22l1-1" 
            stroke="#0EA5E9" strokeWidth="1.5" fill="none"/>
    </svg>
  ),
  thunderstorm: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 16a4 4 0 100-8 4 4 0 000 8z" fill="#4B5563"/>
      <path d="M16 18a4 4 0 100-8 4 4 0 000 8z" fill="#374151" opacity="0.9"/>
      <path d="M10 12l-2 4h3l-2 4 5-6h-3l2-4-4 2z" fill="#F59E0B"/>
    </svg>
  ),
  unknown: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1" fill="none"/>
      <text x="12" y="16" textAnchor="middle" fontSize="12" fill="currentColor">?</text>
    </svg>
  )
};

const WeatherIcon: React.FC<WeatherIconProps> = ({ 
  code, 
  temperature, 
  size = 20,
  textSize = 14,
  showText = false 
}) => {
  const getWeatherInfo = (weatherCode: number) => {
    // WMO Weather interpretation codes (WW) sa SVG ikonama
    const weatherMap: Record<number, { 
      icon: JSX.Element;
      description: string; 
      color: string;
    }> = {
      // Clear sky
      0: { 
        icon: WeatherIcons.clear,
        description: 'Vedro', 
        color: 'text-yellow-300'
      },
      
      // Mainly clear, partly cloudy, and overcast
      1: { 
        icon: WeatherIcons.partlyCloudy,
        description: 'Uglavnom vedro', 
        color: 'text-yellow-200'
      },
      2: { 
        icon: WeatherIcons.partlyCloudy,
        description: 'Djelomično oblačno', 
        color: 'text-blue-200'
      },
      3: { 
        icon: WeatherIcons.overcast,
        description: 'Oblačno', 
        color: 'text-gray-300'
      },
      
      // Fog and depositing rime fog
      45: { 
        icon: WeatherIcons.fog,
        description: 'Magla', 
        color: 'text-gray-400'
      },
      48: { 
        icon: WeatherIcons.fog,
        description: 'Smrznuta magla', 
        color: 'text-blue-100'
      },
      
      // Drizzle
      51: { 
        icon: WeatherIcons.drizzle,
        description: 'Slaba kiša', 
        color: 'text-blue-300'
      },
      53: { 
        icon: WeatherIcons.drizzle,
        description: 'Umjerena kiša', 
        color: 'text-blue-400'
      },
      55: { 
        icon: WeatherIcons.rain,
        description: 'Jaka kiša', 
        color: 'text-blue-500'
      },
      
      // Rain
      61: { 
        icon: WeatherIcons.rain,
        description: 'Slaba kiša', 
        color: 'text-blue-400'
      },
      63: { 
        icon: WeatherIcons.rain,
        description: 'Umjerena kiša', 
        color: 'text-blue-500'
      },
      65: { 
        icon: WeatherIcons.rain,
        description: 'Jaka kiša', 
        color: 'text-blue-600'
      },
      
      // Freezing Rain
      66: { 
        icon: WeatherIcons.rain,
        description: 'Smrzavajuća kiša', 
        color: 'text-blue-300'
      },
      67: { 
        icon: WeatherIcons.rain,
        description: 'Jaka smrzavajuća kiša', 
        color: 'text-blue-400'
      },
      
      // Snow
      71: { 
        icon: WeatherIcons.snow,
        description: 'Slab snijeg', 
        color: 'text-blue-100'
      },
      73: { 
        icon: WeatherIcons.snow,
        description: 'Umjeren snijeg', 
        color: 'text-blue-200'
      },
      75: { 
        icon: WeatherIcons.snow,
        description: 'Jak snijeg', 
        color: 'text-blue-300'
      },
      77: { 
        icon: WeatherIcons.snow,
        description: 'Sniježne pahulje', 
        color: 'text-white'
      },
      
      // Rain showers
      80: { 
        icon: WeatherIcons.drizzle,
        description: 'Slabi pljuskovi', 
        color: 'text-blue-400'
      },
      81: { 
        icon: WeatherIcons.rain,
        description: 'Umjereni pljuskovi', 
        color: 'text-blue-500'
      },
      82: { 
        icon: WeatherIcons.rain,
        description: 'Jaki pljuskovi', 
        color: 'text-blue-600'
      },
      
      // Snow showers
      85: { 
        icon: WeatherIcons.snow,
        description: 'Sniježni pljuskovi', 
        color: 'text-blue-200'
      },
      86: { 
        icon: WeatherIcons.snow,
        description: 'Jaki sniježni pljuskovi', 
        color: 'text-blue-300'
      },
      
      // Thunderstorm
      95: { 
        icon: WeatherIcons.thunderstorm,
        description: 'Grmljavina', 
        color: 'text-purple-400'
      },
      96: { 
        icon: WeatherIcons.thunderstorm,
        description: 'Grmljavina sa gradom', 
        color: 'text-purple-500'
      },
      99: { 
        icon: WeatherIcons.thunderstorm,
        description: 'Jaka grmljavina sa gradom', 
        color: 'text-purple-600'
      },
    };

    return weatherMap[weatherCode] || { 
      icon: WeatherIcons.unknown,
      description: 'Nepoznato', 
      color: 'text-gray-300'
    };
  };

  const weatherInfo = getWeatherInfo(code);
  const roundedTemp = Math.round(temperature);

  return (
    <div 
      className="flex items-center gap-1 bg-black/20 rounded-lg px-2 py-1 border border-white/20 backdrop-blur-sm"
      title={`${weatherInfo.description}, ${roundedTemp}°C`}
    >
      <div 
        style={{ width: `${size}px`, height: `${size}px` }}
        className={weatherInfo.color}
      >
        {weatherInfo.icon}
      </div>
      <span 
        style={{ fontSize: `${textSize}px` }}
        className="text-white font-bold whitespace-nowrap drop-shadow-sm"
      >
        {roundedTemp}°
      </span>
      {showText && (
        <span 
          style={{ fontSize: `${textSize - 2}px` }}
          className="text-white opacity-80 hidden lg:block ml-1"
        >
          {weatherInfo.description}
        </span>
      )}
    </div>
  );
};

export default WeatherIcon;