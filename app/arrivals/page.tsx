'use client';

import { JSX, useEffect, useState, useCallback, useMemo } from 'react';
import Image from 'next/image';
import type { Flight } from '@/types/flight';
import { fetchFlightData } from '@/lib/flight-service';
import { AlertCircle, Info, Plane, Clock, MapPin, Luggage } from 'lucide-react';

// Flightaware logo URL generator
const getFlightawareLogoURL = (icaoCode: string): string => {
  if (!icaoCode) {
    return 'https://via.placeholder.com/180x120?text=No+Logo';
  }
  return `https://www.flightaware.com/images/airline_logos/180px/${icaoCode}.png`;
};

// Base64 placeholder image
const placeholderImage = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiBmaWxsPSIjMzQzQzU0Ii8+Cjx0ZXh0IHg9IjE2IiB5PSIxNiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgZmlsbD0iIzlDQTdCNiIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjgiPk5vIExvZ288L3RleHQ+Cjwvc3ZnPgo=';

export default function ArrivalsPage(): JSX.Element {
  const [flights, setFlights] = useState<Flight[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [lastUpdate, setLastUpdate] = useState<string>('');
  const [currentTime, setCurrentTime] = useState<string>('');
  const [ledState, setLedState] = useState<boolean>(false);

  // LED blinking effect for various statuses
  useEffect(() => {
    const ledInterval = setInterval(() => {
      setLedState(prev => !prev);
    }, 500); // Blink every 500ms

    return () => clearInterval(ledInterval);
  }, []);

  // Memoized time formatter - improved version
  const formatTime = useCallback((timeString: string): string => {
    if (!timeString) return '';
    // Handle both "HHmm" and "HH:mm" formats
    const cleanTime = timeString.replace(':', '');
    if (cleanTime.length === 4) {
      return `${cleanTime.substring(0, 2)}:${cleanTime.substring(2, 4)}`;
    }
    return timeString; // Return original if format doesn't match
  }, []);

  // Filter and process flights
  const filterArrivedFlights = useCallback((allFlights: Flight[]): Flight[] => {
    const now = new Date();
    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

    const isArrivedOrDeparted = (status: string): boolean => {
      const statusLower = status.toLowerCase();
      return statusLower.includes('arrived') || 
             statusLower.includes('sletio') || 
             statusLower.includes('departed');
    };

    const getFlightDateTime = (flight: Flight): Date | null => {
      const timeStr = flight.ActualDepartureTime || 
                      flight.EstimatedDepartureTime || 
                      flight.ScheduledDepartureTime;
      if (!timeStr) return null;

      const cleanTime = timeStr.replace(':', '');
      if (cleanTime.length === 4) {
        const [hours, minutes] = [cleanTime.substring(0, 2), cleanTime.substring(2, 4)].map(Number);
        const flightDate = new Date(now);
        flightDate.setHours(hours, minutes, 0, 0);
        return flightDate;
      }
      return null;
    };

    const arrivedFlights: Flight[] = [];
    const activeFlights: Flight[] = [];

    allFlights.forEach((flight) => {
      if (isArrivedOrDeparted(flight.StatusEN)) {
        arrivedFlights.push(flight);
      } else {
        activeFlights.push(flight);
      }
    });

    const sortedArrivedFlights = arrivedFlights.sort((a, b) => {
      const timeA = getFlightDateTime(a);
      const timeB = getFlightDateTime(b);
      if (!timeA || !timeB) return 0;
      return timeB.getTime() - timeA.getTime();
    });

    const recentArrivedFlights = sortedArrivedFlights
      .filter((flight) => {
        const flightTime = getFlightDateTime(flight);
        return flightTime && flightTime >= thirtyMinutesAgo;
      })
      .slice(0, 2);

    const combinedFlights = [...activeFlights, ...recentArrivedFlights];

    return combinedFlights.sort((a, b) => {
      const timeA = a.EstimatedDepartureTime || a.ScheduledDepartureTime;
      const timeB = b.EstimatedDepartureTime || b.ScheduledDepartureTime;
      if (!timeA) return 1;
      if (!timeB) return -1;
      return timeA.localeCompare(timeB);
    });
  }, []);

  // Load flights data
  useEffect(() => {
    const loadFlights = async (): Promise<void> => {
      try {
        setLoading(true);
        const data = await fetchFlightData();
        const filteredFlights = filterArrivedFlights(data.arrivals);
        setFlights(filteredFlights);
        setLastUpdate(new Date().toLocaleTimeString('en-GB'));
      } catch (error) {
        console.error('Failed to load flights:', error);
      } finally {
        setLoading(false);
      }
    };

    loadFlights().catch((error) => {
      console.error('Failed to load flights:', error);
    });

    const interval = setInterval(loadFlights, 60000);
    return () => clearInterval(interval);
  }, [filterArrivedFlights]);

  // Set up time interval
  useEffect(() => {
    const updateTime = (): void => {
      setCurrentTime(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
    };

    updateTime();
    const timeInterval = setInterval(updateTime, 1000);
    return () => clearInterval(timeInterval);
  }, []);

  // Enhanced image error handler
  const handleImageError = useCallback((e: React.SyntheticEvent<HTMLImageElement>): void => {
    const target = e.currentTarget;
    target.src = placeholderImage;
    target.style.display = 'block';
  }, []);

  // Status color mapping
  const getStatusColor = useCallback((status: string): string => {
    const statusLower = status.toLowerCase();
    if (statusLower.includes('cancelled') || statusLower.includes('otkazan')) return 'text-red-500';
    if (statusLower.includes('arrived') || statusLower.includes('sletio')) return 'text-green-500';
    if (statusLower.includes('delay') || statusLower.includes('kasni')) return 'text-red-400';
    if (statusLower.includes('landing') || statusLower.includes('approach')) return 'text-blue-400';
    if (statusLower.includes('on time')) return 'text-yellow-400';
    return 'text-slate-300';
  }, []);

  // Check if flight is delayed
  const isDelayed = useCallback((flight: Flight): boolean => {
    const statusLower = flight.StatusEN.toLowerCase();
    return statusLower.includes('delay') || statusLower.includes('kasni');
  }, []);

  // Check if flight is early
  const isEarly = useCallback((flight: Flight): boolean => {
    const statusLower = flight.StatusEN.toLowerCase();
    return statusLower.includes('earlier') || statusLower.includes('ranije') || statusLower.includes('prije vremena');
  }, []);

  // Check if flight is cancelled
  const isCancelled = useCallback((flight: Flight): boolean => {
    const statusLower = flight.StatusEN.toLowerCase();
    return statusLower.includes('cancelled') || statusLower.includes('otkazan');
  }, []);

  // Blink row for important statuses
  const shouldBlinkRow = useCallback((flight: Flight): boolean => {
    const statusLower = flight.StatusEN.toLowerCase();
    const isArrived = statusLower.includes('arrived') || 
                     statusLower.includes('sletio') || 
                     statusLower.includes('landed');
    const isCancelledFlight = isCancelled(flight);
    const isDelayedFlight = isDelayed(flight);

    return isArrived || isCancelledFlight || isDelayedFlight;
  }, [isDelayed, isCancelled]);

  // Format terminal display
  const formatTerminal = useCallback((terminal?: string): string => {
    if (!terminal) return '-';
    return terminal.replace('T0', 'T').replace('T', 'T ');
  }, []);

  // LED indicator component
  const LEDIndicator = useCallback(({ 
    color, 
    isActive 
  }: { 
    color: 'blue' | 'green' | 'orange' | 'red';
    isActive: boolean;
  }) => {
    const colorClasses = {
      blue: isActive ? 'bg-blue-400' : 'bg-blue-800',
      green: isActive ? 'bg-green-400' : 'bg-green-800',
      orange: isActive ? 'bg-orange-400' : 'bg-orange-800',
      red: isActive ? 'bg-red-400' : 'bg-red-800'
    };

    return (
      <div className={`w-3 h-3 rounded-full ${colorClasses[color]}`} />
    );
  }, []);

  // Memoized sorted flights
  const sortedFlights = useMemo(() => {
    return [...flights].sort((a, b) => {
      const timeA = a.ScheduledDepartureTime || '99:99';
      const timeB = b.ScheduledDepartureTime || '99:99';
      return timeA.localeCompare(timeB);
    });
  }, [flights]);

  // Table headers configuration
  const tableHeaders = useMemo(() => [
    { label: 'Scheduled', span: 1, icon: Clock },
    { label: 'Estimated', span: 1, icon: Clock },
    { label: 'Flight', span: 2, icon: Plane },
    { label: 'From', span: 3, icon: MapPin },
    { label: 'Status', span: 3, icon: Info },
    { label: 'Baggage Belt', span: 2, icon: Luggage }
  ], []);

  // Status legend items
  const statusLegend = useMemo(() => [
    { label: 'On Time', color: 'yellow' },
    { label: 'Delayed', color: 'red' },
    { label: 'Landed', color: 'green' },
    { label: 'Approach', color: 'blue' },
    { label: 'Cancelled', color: 'red' },
    { label: 'Earlier', color: 'green' },
  ], []);

  return (
    <div className="h-screen bg-gradient-to-br from-blue-950 via-blue-900 to-slate-900 text-white p-2 transition-all duration-500 flex flex-col">
      {/* Header */}
      <div className="w-[95%] mx-auto mb-2 flex-shrink-0">
        <div className="flex flex-col lg:flex-row justify-between items-center gap-2 mb-2">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-white/10 rounded-2xl backdrop-blur-sm border border-white/20">
              <Plane className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <h1 className="text-5xl lg:text-[4rem] font-black bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                ARRIVALS
              </h1>
              <p className="text-slate-400 text-lg mt-0.5">
                Real-time arrival information • Incoming flights
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="text-right">
              <div className="text-[4rem] font-bold text-cyan-300">
                {currentTime || '--:--'}
              </div>
              {lastUpdate && (
                <div className="text-xs text-slate-400">
                  Updated: {lastUpdate}
                </div>
              )}
            </div>
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          </div>
        </div>
      </div>

      {/* Flight Board - Maximum height */}
      <div className="w-[95%] mx-auto flex-1 min-h-0">
        {loading && sortedFlights.length === 0 ? (
          <div className="text-center p-8 h-full flex items-center justify-center">
            <div className="inline-flex items-center gap-3">
              <div className="w-6 h-6 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-base text-slate-300">Loading arrival information...</span>
            </div>
          </div>
        ) : (
          <div className="bg-white/5 backdrop-blur-lg rounded-2xl border border-white/10 shadow-2xl overflow-hidden h-full flex flex-col">
            {/* Table Header */}
            <div className="grid grid-cols-12 gap-1 p-1 bg-white/10 border-b border-white/10 font-semibold text-slate-300 text-xs uppercase tracking-wider flex-shrink-0">
              {tableHeaders.map((header) => {
                const IconComponent = header.icon;
                return (
                  <div 
                    key={header.label}
                    className={`col-span-${header.span} flex items-center gap-1 justify-center`}
                  >
                    <IconComponent className="w-3 h-3" />
                    <span>{header.label}</span>
                  </div>
                );
              })}
            </div>

            {/* Flight Rows - Maximum height with scrolling */}
            <div className="divide-y divide-white/5 flex-1 overflow-y-auto">
              {sortedFlights.length === 0 ? (
                <div className="p-6 text-center text-slate-400 h-full flex items-center justify-center">
                  <Plane className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <div className="text-sm">No arrivals scheduled</div>
                </div>
              ) : (
                sortedFlights.map((flight, index) => {
                  const shouldBlink = shouldBlinkRow(flight);
                  const isCancelledFlight = isCancelled(flight);
                  const isDelayedFlight = isDelayed(flight);
                  const isEarlyFlight = isEarly(flight);

                  // Generate Flightaware logo URL
                  const flightawareLogoURL = getFlightawareLogoURL(flight.AirlineICAO);

                  return (
                    <div
                      key={`${flight.FlightNumber}-${index}-${flight.ScheduledDepartureTime}`}
                      className={`grid grid-cols-12 gap-1 p-1 items-center transition-all duration-300 hover:bg-white/5
                        ${shouldBlink ? 'animate-row-blink' : ''}
                        ${index % 2 === 0 ? 'bg-white/2' : 'bg-transparent'}`}
                      style={{ minHeight: '45px' }}
                    >
                      {/* Scheduled Time */}
                      <div className="col-span-1 text-center">
                        <div className="text-4xl font-mono font-bold text-white">
                          {flight.ScheduledDepartureTime ? (
                            <span className="text-white">
                              {flight.ScheduledDepartureTime}
                            </span>
                          ) : (
                            <span className="text-slate-400">--:--</span>
                          )}
                        </div>
                      </div>

                      {/* Estimated Time */}
                      <div className="col-span-1 text-center">
                        {flight.EstimatedDepartureTime && 
                         flight.EstimatedDepartureTime !== flight.ScheduledDepartureTime ? (
                          <div className="text-4xl font-mono font-bold text-yellow-400">
                            {formatTime(flight.EstimatedDepartureTime)}
                          </div>
                        ) : (
                          <div className="text-lg text-slate-500">-</div>
                        )}
                      </div>

                      {/* Flight Info with Flightaware logos only - UPDATED LOGO CONTAINER */}
                      <div className="col-span-2">
                        <div className="flex items-center gap-1">
                          <div className="relative w-[150px] h-20 bg-white rounded-lg p-1 shadow flex items-center justify-center">
                            <img
                              src={flightawareLogoURL}
                              alt={`${flight.AirlineName} logo`}
                              className="object-contain w-full h-full"
                              onError={handleImageError}
                            />
                          </div>
                          <div>
                            <div className="text-4xl font-black text-white">{flight.FlightNumber}</div>
                            <div className="text-xs text-slate-400 truncate max-w-[90px]">
                              {flight.AirlineName}
                            </div>
                          </div>
                        </div>
                        {flight.CodeShareFlights && flight.CodeShareFlights.length > 0 && (
                          <div className="text-xs text-slate-500 mt-0">
                            +{flight.CodeShareFlights.length} codeshare
                          </div>
                        )}
                      </div>

                      {/* Origin - Using available properties */}
                      <div className="col-span-3">
                        <div className="text-5xl font-bold text-yellow-500 truncate">
                          {flight.DestinationCityName || flight.DestinationAirportName}
                        </div>
                        <div className="text-lg font-mono text-orange-400 font-bold">
                          {flight.DestinationAirportCode}
                        </div>
                      </div>

                      {/* Status with LED indicators */}
                      <div className="col-span-3">
                        <div className={`text-4xl font-semibold ${getStatusColor(flight.StatusEN)}`}>
                          {isCancelledFlight ? (
                            <div className="flex items-center gap-1 bg-red-500/10 px-2 py-1 rounded border border-red-500/20 justify-center">
                              {/* Red LED indicators for cancelled */}
                              <div className="flex gap-1 mr-2">
                                <LEDIndicator color="red" isActive={ledState} />
                                <LEDIndicator color="red" isActive={!ledState} />
                              </div>
                              <AlertCircle className="w-4 h-4 text-red-500" />
                              <span>Cancelled</span>
                            </div>
                          ) : isDelayedFlight ? (
                            <div className="flex items-center gap-1 bg-orange-400/10 px-2 py-1 rounded border border-orange-400/20 justify-center">
                              {/* Orange LED indicators for delay */}
                              <div className="flex gap-1 mr-2">
                                <LEDIndicator color="orange" isActive={ledState} />
                                <LEDIndicator color="orange" isActive={!ledState} />
                              </div>
                              <AlertCircle className="w-4 h-4 text-orange-400" />
                              <span>Delay</span>
                            </div>
                          ) : isEarlyFlight ? (
                            <div className="flex items-center gap-1 bg-green-400/10 px-2 py-1 rounded border border-green-400/20 justify-center">
                              {/* Green LED indicators for early */}
                              <div className="flex gap-1 mr-2">
                                <LEDIndicator color="green" isActive={ledState} />
                                <LEDIndicator color="green" isActive={!ledState} />
                              </div>
                              <span>Earlier</span>
                            </div>
                          ) : flight.StatusEN?.toLowerCase().includes('arrived') || 
                              flight.StatusEN?.toLowerCase().includes('sletio') ? (
                            <div className="flex items-center gap-1 bg-green-500/10 px-2 py-1 rounded border border-green-500/20 justify-center">
                              <span className="w-3 h-3 rounded-full bg-green-500 animate-blink" />
                              <span>Arrived</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 justify-center">
                              {shouldBlink && <Info className="w-4 h-4" />}
                              <span className="truncate">{flight.StatusEN || 'Scheduled'}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Baggage Belt */}
                      <div className="col-span-2 text-center">
                        <div className="text-xl font-black text-white bg-slate-800/50 py-1 rounded">
                          {flight.BaggageReclaim || '-'}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer - Reduced height */}
      <div className="w-[95%] mx-auto mt-1 text-center flex-shrink-0">
        <div className="text-slate-500 text-xs py-1">
          <div className="flex items-center justify-center gap-2 mb-0">
            <span>Code by: alen.vocanec@apm.co.me</span>
            <span>•</span>
            <span>Auto Refresh</span>
          </div>
          <div>Arrival information updates every minute</div>
        </div>
      </div>

      {/* Custom animations */}
      <style jsx global>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0.3; }
        }
        @keyframes row-blink {
          0%, 50% { 
            background-color: rgba(96, 165, 250, 0.4);
            box-shadow: 0 0 12px rgba(96, 165, 250, 0.6);
          }
          51%, 100% { 
            background-color: inherit;
            box-shadow: none;
          }
        }
        .animate-blink {
          animation: blink 800ms infinite;
        }
        .animate-row-blink {
          animation: row-blink 800ms infinite;
        }
        ::-webkit-scrollbar { 
          width: 4px;
        }
        ::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 2px;
        }
        ::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.3);
          border-radius: 2px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.5);
        }
        html, body { 
          overflow: hidden;
          margin: 0;
          padding: 0;
          height: 100vh;
        }
        #__next {
          height: 100vh;
        }
      `}</style>
    </div>
  );
}