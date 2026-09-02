"use client";

import Image from 'next/image';
import type { Flight } from '@/types/flight';

interface ChristmasInactiveScreenProps {
  deskNumberParam: string;
  nextFlight: Flight | null;
  lastUpdate: string;
  loading: boolean;
  isPortrait: boolean;
  displayFlight: Flight | null;
}

export default function ChristmasInactiveScreen({
  deskNumberParam,
  nextFlight,
  lastUpdate,
  loading,
  isPortrait,
  displayFlight
}: ChristmasInactiveScreenProps) {
  const wallpaperSrc = isPortrait ? '/wallpaper.jpg' : '/wallpaper-landscape.jpg';
  
  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Wallpaper */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        <Image
          src={wallpaperSrc}
          alt="Airport Wallpaper"
          fill
          className="object-cover"
          priority
          quality={90}
        />
        <div className="absolute inset-0 bg-black/40"></div>
        
        {/* Snejne pahulje */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {[...Array(20)].map((_, i) => (
            <div
              key={i}
              className="absolute text-white/30 text-3xl font-bold"
              style={{
                left: `${Math.random() * 100}%`,
                animation: `snowfall ${5 + Math.random() * 3}s linear infinite`,
                animationDelay: `${Math.random() * 5}s`,
                top: '-50px'
              }}
            >
              *
            </div>
          ))}
        </div>
        
        {/* Lampioni u ćoškovima */}
        <div className="absolute top-6 left-6 w-4 h-8 bg-yellow-300 rounded-full shadow-lg shadow-yellow-400/50 pulse-animation"></div>
        <div className="absolute top-6 right-6 w-4 h-8 bg-red-300 rounded-full shadow-lg shadow-red-400/50 pulse-animation" style={{animationDelay: '0.5s'}}></div>
        <div className="absolute bottom-6 left-6 w-4 h-8 bg-green-300 rounded-full shadow-lg shadow-green-400/50 pulse-animation" style={{animationDelay: '1s'}}></div>
        <div className="absolute bottom-6 right-6 w-4 h-8 bg-blue-300 rounded-full shadow-lg shadow-blue-400/50 pulse-animation" style={{animationDelay: '1.5s'}}></div>
      </div>
      
      {/* Sadržaj */}
      <div className="relative z-10 min-h-screen flex items-center justify-center p-4 text-white overflow-hidden">
        <div className={`text-center bg-white/10 backdrop-blur-md rounded-3xl p-12 border-2 border-yellow-400/40 shadow-2xl relative overflow-hidden ${
          isPortrait ? 'max-w-4xl' : 'max-w-6xl'
        } mx-auto`}>
          
          {/* Ukrasi na uglovima - CSS TRIANGLES */}
          <div className="absolute -top-4 -left-4 opacity-70 bounce-animation">
            <div className="triangle-icon">
              <div className="triangle-top"></div>
              <div className="triangle-middle"></div>
              <div className="triangle-bottom"></div>
            </div>
          </div>
          
          <div className="absolute -top-4 -right-4 opacity-70 bounce-animation" style={{animationDelay: '0.3s'}}>
            <div className="star-icon">★</div>
          </div>
          
          <div className="absolute -bottom-4 -left-4 opacity-70 bounce-animation" style={{animationDelay: '0.7s'}}>
            <div className="candle-icon">
              <div className="flame"></div>
              <div className="candle"></div>
            </div>
          </div>
          
          <div className="absolute -bottom-4 -right-4 opacity-70 bounce-animation" style={{animationDelay: '1s'}}>
            <div className="snowflake-icon">
              <div className="cross"></div>
              <div className="cross rotate-45"></div>
            </div>
          </div>
          
          {/* ✅ OVO JE ORIGINALNI CHECK MARK KOJI JE RANIJE RADIO ✅ */}
          <div className="relative mb-8">
            <div className="w-32 h-32 bg-gradient-to-br from-red-400 to-green-400 rounded-full mx-auto flex items-center justify-center shadow-lg mb-2">
              {/* OVO JE STARI CHECK MARK KOJI SE DOBRO PRIKAZIVAO */}
              <div className="checkmark-large">✓</div>
            </div>
            
            {/* Heart CSS */}
            <div className="absolute -top-2 -right-2 bounce-animation">
              <div className="heart-icon"></div>
            </div>
            
            {/* Gift CSS */}
            <div className="absolute -bottom-2 -left-2 bounce-animation" style={{animationDelay: '0.5s'}}>
              <div className="gift-icon">
                <div className="gift-box"></div>
                <div className="gift-bow"></div>
              </div>
            </div>
          </div>
          
          {/* Glavni tekst */}
          <div className="text-center mb-4">
            <div className={`font-bold text-white/80 mb-2 flex items-center justify-center gap-4 ${
              isPortrait ? 'text-[5rem]' : 'text-[3.5rem]'
            }`}>
              <span className="triangle-symbol text-green-400 opacity-80"></span>
              Check-in
              <span className="sparkle-symbol text-yellow-400 opacity-80"></span>
            </div>
            <div className={`font-black leading-none gradient-text ${
              isPortrait ? 'text-[18rem]' : 'text-[13rem]'
            }`}>
              {deskNumberParam}
            </div>
          </div>
          
          {/* Poruka */}
          <div className={`text-white/90 mb-6 font-semibold ${
            isPortrait ? 'text-4xl' : 'text-3xl'
          }`}>
            <div className="flex items-center justify-center gap-3">
              <span className="hourglass-symbol text-3xl">⌛</span>
              {displayFlight ? 'Check-in not available' : 'No flights currently checking in here'}
              <span className="target-symbol text-3xl">◎</span>
            </div>
          </div>

          {/* Prikaz sledećeg leta */}
          {nextFlight && (
            <div className={`mb-6 font-medium py-4 px-8 rounded-2xl border-2 border-yellow-400/50 shadow-lg next-flight-card ${
              isPortrait ? 'text-3xl' : 'text-2xl'
            }`}>
              <div className="flex items-center justify-center gap-3 mb-2">
                <span className="plane-symbol text-3xl text-yellow-400 pulse-animation"></span>
                <span className="text-orange-300 font-bold">Next Flight</span>
                <span className="plane-symbol text-3xl text-blue-400 pulse-animation" style={{animationDelay: '0.3s'}}></span>
              </div>
              <div className="text-white font-bold mb-1">
                {nextFlight.FlightNumber} → {nextFlight.DestinationCityName}
              </div>
              <div className="text-yellow-300 text-lg flex items-center justify-center gap-2">
                <span className="aircraft-symbol text-lg"></span> {nextFlight.ScheduledDepartureTime}
              </div>
            </div>
          )}

          <div className={`text-white/80 mb-6 ${
            isPortrait ? 'text-2xl' : 'text-xl'
          }`}>
            {displayFlight ? (
              <div className="flex items-center justify-center gap-3">
                <span className="star-symbol text-2xl"></span>
                <span>Status:</span>
                <span className="text-yellow-300 font-semibold">{displayFlight.StatusEN}</span>
                <span className="text-2xl text-green-400 triangle-symbol"></span>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-3">
                <span className="text-2xl">👁</span>
                <span>Please check the main display</span>
                <span className="text-2xl text-yellow-400 pulse-animation sparkle-symbol">✦</span>
              </div>
            )}
          </div>

          {/* Updated at */}
          <div className={`text-white/70 mb-4 ${
            isPortrait ? 'text-xl' : 'text-lg'
          }`}>
            <div className="flex items-center justify-center gap-3">
              <span className="text-xl"></span>
              <span>Updated at:</span>
              <span className="text-cyan-300 font-mono">{lastUpdate || 'Never'}</span>
              <span className="aircraft-symbol text-xl"></span>
            </div>
          </div>

          {/* Specijalna poruka */}
          <div className={`text-yellow-300 mb-6 font-semibold py-3 px-6 rounded-xl border border-yellow-400/30 seasonal-message ${
            isPortrait ? 'text-2xl' : 'text-xl'
          }`}>
            <div className="flex items-center justify-center gap-3">
              <span className="star-symbol text-2xl bounce-animation"></span>
              <span>Season&apos;s Greetings!</span>
              <span className="text-2xl bounce-animation" style={{animationDelay: '0.5s'}}>▲</span>
            </div>
          </div>

          {/* Loading */}
          {loading && (
            <div className={`text-white/60 mt-4 ${
              isPortrait ? 'text-lg' : 'text-base'
            }`}>
              <div className="flex items-center justify-center gap-3">
                <span>Updating flight information...</span>
                <span className="text-xl inline-block spin-animation">*</span>
              </div>
            </div>
          )}

          {/* Tekst u ćoškovima */}
          <div className="absolute top-4 left-4 text-sm text-yellow-300/60 rotate-12">Happy Holidays</div>
          <div className="absolute top-4 right-4 text-sm text-green-300/60 -rotate-12">2026</div>
        </div>
      </div>

      {/* Dodatni elementi */}
      <div className="absolute bottom-10 left-10 opacity-20 pulse-animation">
        <div className="css-gift-large"></div>
      </div>
      <div className="absolute top-10 right-10 opacity-20 pulse-animation" style={{animationDelay: '1s'}}>
        <div className="css-bell-large"></div>
      </div>
      <div className="absolute top-1/4 left-10 opacity-15 bounce-animation" style={{animationDelay: '0.5s'}}>
        <div className="star-symbol-large">★</div>
      </div>
      <div className="absolute bottom-1/4 right-10 opacity-15 bounce-animation" style={{animationDelay: '0.7s'}}>
        <div className="sparkle-symbol-large">✦</div>
      </div>

      {/* Inline styles */}
      <style jsx>{`
        /* Animacije */
        @keyframes snowfall {
          0% {
            transform: translateY(-50px) rotate(0deg);
            opacity: 0;
          }
          10% {
            opacity: 0.3;
          }
          90% {
            opacity: 0.3;
          }
          100% {
            transform: translateY(100vh) rotate(360deg);
            opacity: 0;
          }
        }
        
        @keyframes bounce {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-10px);
          }
        }
        
        @keyframes pulse {
          0%, 100% { 
            opacity: 1; 
          }
          50% { 
            opacity: 0.5; 
          }
        }
        
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        
        @keyframes flicker {
          0%, 100% { 
            opacity: 1;
            transform: scale(1);
          }
          50% { 
            opacity: 0.8;
            transform: scale(0.95);
          }
        }
        
        /* ✅ ORIGINALNI CHECK MARK ✅ */
        .checkmark-large {
          font-size: 64px;
          color: white;
          font-weight: bold;
          line-height: 1;
        }
        
        /* CSS ikonice */
        .triangle-icon {
          width: 48px;
          height: 48px;
          position: relative;
        }
        
        .triangle-top, .triangle-middle, .triangle-bottom {
          position: absolute;
          border-left: 20px solid transparent;
          border-right: 20px solid transparent;
          border-bottom: 15px solid #4ade80;
        }
        
        .triangle-top {
          top: 0;
          left: 4px;
        }
        
        .triangle-middle {
          top: 15px;
          left: 0;
          border-left-width: 24px;
          border-right-width: 24px;
          border-bottom-width: 18px;
        }
        
        .triangle-bottom {
          top: 33px;
          left: 22px;
          width: 0;
          height: 0;
          border-left: 8px solid transparent;
          border-right: 8px solid transparent;
          border-top: 12px solid #92400e;
          border-bottom: none;
        }
        
        .star-icon {
          width: 48px;
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fbbf24;
          font-size: 48px;
          line-height: 1;
        }
        
        .candle-icon {
          width: 48px;
          height: 48px;
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        
        .flame {
          width: 12px;
          height: 12px;
          background: #fbbf24;
          border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
          animation: flicker 0.5s infinite;
          box-shadow: 0 0 10px #fbbf24;
        }
        
        .candle {
          width: 16px;
          height: 32px;
          background: #fb923c;
          border-radius: 8px 8px 4px 4px;
          margin-top: 4px;
        }
        
        .snowflake-icon {
          width: 48px;
          height: 48px;
          position: relative;
        }
        
        .cross {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .cross:before,
        .cross:after {
          content: '';
          position: absolute;
          background: #60a5fa;
          border-radius: 2px;
        }
        
        .cross:before {
          width: 32px;
          height: 4px;
        }
        
        .cross:after {
          width: 4px;
          height: 32px;
        }
        
        .heart-icon {
          width: 32px;
          height: 32px;
          position: relative;
          transform: rotate(45deg);
          background: #f87171;
        }
        
        .heart-icon:before,
        .heart-icon:after {
          content: '';
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: #f87171;
          position: absolute;
        }
        
        .heart-icon:before {
          top: -16px;
          left: 0;
        }
        
        .heart-icon:after {
          top: 0;
          left: -16px;
        }
        
        .gift-icon {
          width: 32px;
          height: 32px;
          position: relative;
        }
        
        .gift-box {
          width: 32px;
          height: 32px;
          background: #4ade80;
          border-radius: 6px;
          position: relative;
        }
        
        .gift-box:before,
        .gift-box:after {
          content: '';
          position: absolute;
          background: #fbbf24;
        }
        
        .gift-box:before {
          width: 100%;
          height: 4px;
          top: 50%;
          transform: translateY(-50%);
        }
        
        .gift-box:after {
          width: 4px;
          height: 100%;
          left: 50%;
          transform: translateX(-50%);
        }
        
        .gift-bow {
          position: absolute;
          top: -4px;
          left: 50%;
          transform: translateX(-50%);
          width: 0;
          height: 0;
          border-left: 12px solid transparent;
          border-right: 12px solid transparent;
          border-bottom: 12px solid #fbbf24;
        }
        
        /* CSS GIFT (poklon) - veliki */
        .css-gift-large {
          width: 96px;
          height: 96px;
          background: #4ade80;
          border-radius: 10px;
          position: relative;
        }
        
        .css-gift-large:before,
        .css-gift-large:after {
          content: '';
          position: absolute;
          background: #fbbf24;
        }
        
        .css-gift-large:before {
          width: 100%;
          height: 10px;
          top: 50%;
          transform: translateY(-50%);
        }
        
        .css-gift-large:after {
          width: 10px;
          height: 100%;
          left: 50%;
          transform: translateX(-50%);
        }
        
        /* CSS BELL (zvono) - veliki */
        .css-bell-large {
          width: 96px;
          height: 96px;
          background: white;
          border-radius: 50% 50% 0 0;
          position: relative;
        }
        
        .css-bell-large:before {
          content: '';
          position: absolute;
          top: -20px;
          left: 50%;
          transform: translateX(-50%);
          width: 20px;
          height: 20px;
          background: white;
          border-radius: 50%;
        }
        
        .css-bell-large:after {
          content: '';
          position: absolute;
          bottom: 10px;
          left: 50%;
          transform: translateX(-50%);
          width: 60px;
          height: 10px;
          background: white;
          border-radius: 5px;
        }
        
        /* Simboli za velike ikone */
        .star-symbol-large {
          font-size: 84px;
          color: white;
        }
        
        .sparkle-symbol-large {
          font-size: 84px;
          color: white;
        }
        
        /* Klase za animacije */
        .bounce-animation {
          animation: bounce 1s infinite;
        }
        
        .pulse-animation {
          animation: pulse 2s infinite;
        }
        
        .spin-animation {
          animation: spin 1s linear infinite;
        }
        
        /* Gradient text */
        .gradient-text {
          background: linear-gradient(to right, #f87171, #fbbf24, #4ade80);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          text-fill-color: transparent;
          filter: drop-shadow(0 10px 20px rgba(0,0,0,0.5));
        }
        
        /* Kartice */
        .next-flight-card {
          background: linear-gradient(to right, rgba(239, 68, 68, 0.2), rgba(234, 179, 8, 0.2), rgba(34, 197, 94, 0.2));
        }
        
        .seasonal-message {
          background: linear-gradient(to right, rgba(239, 68, 68, 0.1), rgba(34, 197, 94, 0.1));
        }
        
        /* Simboli */
        .triangle-symbol:before {
          content: '▲';
        }
        
        .sparkle-symbol:before {
          content: '✦';
        }
        
        .gift-symbol:before {
          content: 'G';
        }
        
        .plane-symbol:before {
          content: '✈';
        }
        
        .hourglass-symbol:before {
          content: '⌛';
        }
        
        .target-symbol:before {
          content: '◎';
        }
        
        .clock-symbol:before {
          content: '🕐';
        }
      `}</style>
    </div>
  );
}