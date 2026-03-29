"use client"

import type React from "react"

import { type JSX, useEffect, useState, useCallback, useMemo } from "react"
import type { Flight } from "@/types/flight"
import { fetchFlightData } from "@/lib/flight-service"
import { AlertCircle, Info, Plane, Clock, MapPin } from "lucide-react"

// Flightaware logo URL generator
const getFlightawareLogoURL = (icaoCode: string): string => {
  if (!icaoCode) {
    return "https://via.placeholder.com/180x120?text=No+Logo"
  }
  return `https://www.flightaware.com/images/airline_logos/180px/${icaoCode}.png`
}

// Base64 placeholder image
const placeholderImage =
  "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiBmaWxsPSIjMzQzQzU0Ii8+Cjx0ZXh0IHg9IjE2IiB5PSIxNiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgZmlsbD0iIzlDQTdCNiIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjgiPk5vIExvZ288L3RleHQ+Cjwvc3ZnPgo="

export default function ArrivalsSmallPage(): JSX.Element {
  const [flights, setFlights] = useState<Flight[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [lastUpdate, setLastUpdate] = useState<string>("")
  const [currentTime, setCurrentTime] = useState<string>("")
  const [ledState, setLedState] = useState<boolean>(false)

  // LED blinking effect for various statuses
  useEffect(() => {
    const ledInterval = setInterval(() => {
      setLedState((prev) => !prev)
    }, 500)
    return () => clearInterval(ledInterval)
  }, [])

  // Memoized time formatter
  const formatTime = useCallback((timeString: string): string => {
    if (!timeString) return ""
    const cleanTime = timeString.replace(":", "")
    if (cleanTime.length === 4) {
      return `${cleanTime.substring(0, 2)}:${cleanTime.substring(2, 4)}`
    }
    return timeString
  }, [])

  // Filter and process flights
  const filterArrivedFlights = useCallback((allFlights: Flight[]): Flight[] => {
    const now = new Date()
    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000)

    const isArrivedOrDeparted = (status: string): boolean => {
      const statusLower = status.toLowerCase()
      return statusLower.includes("arrived") || statusLower.includes("sletio") || statusLower.includes("departed")
    }

    const getFlightDateTime = (flight: Flight): Date | null => {
      const timeStr = flight.ActualDepartureTime || flight.EstimatedDepartureTime || flight.ScheduledDepartureTime
      if (!timeStr) return null

      const cleanTime = timeStr.replace(":", "")
      if (cleanTime.length === 4) {
        const [hours, minutes] = [cleanTime.substring(0, 2), cleanTime.substring(2, 4)].map(Number)
        const flightDate = new Date(now)
        flightDate.setHours(hours, minutes, 0, 0)
        return flightDate
      }
      return null
    }

    const arrivedFlights: Flight[] = []
    const activeFlights: Flight[] = []

    allFlights.forEach((flight) => {
      if (isArrivedOrDeparted(flight.StatusEN)) {
        arrivedFlights.push(flight)
      } else {
        activeFlights.push(flight)
      }
    })

    const sortedArrivedFlights = arrivedFlights.sort((a, b) => {
      const timeA = getFlightDateTime(a)
      const timeB = getFlightDateTime(b)
      if (!timeA || !timeB) return 0
      return timeB.getTime() - timeA.getTime()
    })

    const recentArrivedFlights = sortedArrivedFlights
      .filter((flight) => {
        const flightTime = getFlightDateTime(flight)
        return flightTime && flightTime >= thirtyMinutesAgo
      })
      .slice(0, 2)

    const combinedFlights = [...activeFlights, ...recentArrivedFlights]

    return combinedFlights.sort((a, b) => {
      const timeA = a.EstimatedDepartureTime || a.ScheduledDepartureTime
      const timeB = b.EstimatedDepartureTime || b.ScheduledDepartureTime
      if (!timeA) return 1
      if (!timeB) return -1
      return timeA.localeCompare(timeB)
    })
  }, [])

  // Load flights data
  useEffect(() => {
    const loadFlights = async (): Promise<void> => {
      try {
        setLoading(true)
        const data = await fetchFlightData()
        const filteredFlights = filterArrivedFlights(data.arrivals)
        setFlights(filteredFlights.slice(0, 6))
        setLastUpdate(new Date().toLocaleTimeString("en-GB"))
      } catch (error) {
        console.error("Failed to load flights:", error)
      } finally {
        setLoading(false)
      }
    }

    loadFlights().catch((error) => {
      console.error("Failed to load flights:", error)
    })

    const interval = setInterval(loadFlights, 60000)
    return () => clearInterval(interval)
  }, [filterArrivedFlights])

  // Set up time interval
  useEffect(() => {
    const updateTime = (): void => {
      setCurrentTime(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }))
    }

    updateTime()
    const timeInterval = setInterval(updateTime, 1000)
    return () => clearInterval(timeInterval)
  }, [])

  // Enhanced image error handler
  const handleImageError = useCallback((e: React.SyntheticEvent<HTMLImageElement>): void => {
    const target = e.currentTarget
    target.src = placeholderImage
    target.style.display = "block"
  }, [])

  // Status color mapping
  const getStatusColor = useCallback((status: string): string => {
    const statusLower = status.toLowerCase()
    if (statusLower.includes("cancelled") || statusLower.includes("otkazan")) return "text-red-400"
    if (statusLower.includes("arrived") || statusLower.includes("sletio")) return "text-emerald-400"
    if (statusLower.includes("delay") || statusLower.includes("kasni")) return "text-amber-400"
    if (statusLower.includes("landing") || statusLower.includes("approach")) return "text-cyan-400"
    if (statusLower.includes("on time")) return "text-emerald-400"
    return "text-white"
  }, [])

  // Check if flight is delayed
  const isDelayed = useCallback((flight: Flight): boolean => {
    const statusLower = flight.StatusEN.toLowerCase()
    return statusLower.includes("delay") || statusLower.includes("kasni")
  }, [])

  // Check if flight is early
  const isEarly = useCallback((flight: Flight): boolean => {
    const statusLower = flight.StatusEN.toLowerCase()
    return statusLower.includes("earlier") || statusLower.includes("ranije") || statusLower.includes("prije vremena")
  }, [])

  // Check if flight is cancelled
  const isCancelled = useCallback((flight: Flight): boolean => {
    const statusLower = flight.StatusEN.toLowerCase()
    return statusLower.includes("cancelled") || statusLower.includes("otkazan")
  }, [])

  // Blink row for important statuses
  const shouldBlinkRow = useCallback(
    (flight: Flight): boolean => {
      const statusLower = flight.StatusEN.toLowerCase()
      const isArrived =
        statusLower.includes("arrived") || statusLower.includes("sletio") || statusLower.includes("landed")
      const isCancelledFlight = isCancelled(flight)
      const isDelayedFlight = isDelayed(flight)

      return isArrived || isCancelledFlight || isDelayedFlight
    },
    [isDelayed, isCancelled],
  )

  // LED indicator component
  const LEDIndicator = useCallback(
    ({
      color,
      isActive,
    }: {
      color: "blue" | "green" | "orange" | "red"
      isActive: boolean
    }) => {
      const colorClasses = {
        blue: isActive ? "bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.8)]" : "bg-cyan-900",
        green: isActive ? "bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]" : "bg-emerald-900",
        orange: isActive ? "bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.8)]" : "bg-amber-900",
        red: isActive ? "bg-red-400 shadow-[0_0_12px_rgba(248,113,113,0.8)]" : "bg-red-900",
      }

      return <div className={`w-4 h-4 rounded-full ${colorClasses[color]} transition-all duration-200`} />
    },
    [],
  )

  // Memoized sorted flights
  const sortedFlights = useMemo(() => {
    return [...flights]
      .sort((a, b) => {
        const timeA = a.ScheduledDepartureTime || "99:99"
        const timeB = b.ScheduledDepartureTime || "99:99"
        return timeA.localeCompare(timeB)
      })
      .slice(0, 6)
  }, [flights])

  // Table headers configuration
  const tableHeaders = useMemo(
    () => [
      { label: "Scheduled", span: 2, icon: Clock },
      { label: "Estimated", span: 2, icon: Clock },
      { label: "Flight", span: 3, icon: Plane },
      { label: "Destination", span: 3, icon: MapPin },
      { label: "Status", span: 2, icon: Info },
    ],
    [],
  )

  return (
    <div className="h-screen bg-[#0a1929] text-white p-4 flex flex-col overflow-hidden">
      <div className="w-full mx-auto mb-4 flex-shrink-0">
        <div className="flex flex-col lg:flex-row justify-between items-center gap-4 mb-4">
          <div className="flex items-center gap-4">
            <div className="p-4 bg-cyan-500/20 rounded-3xl backdrop-blur-sm border-2 border-cyan-400/40 shadow-[0_0_20px_rgba(34,211,238,0.3)]">
              <Plane className="w-12 h-12 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-7xl lg:text-8xl font-black text-cyan-400 drop-shadow-[0_0_30px_rgba(34,211,238,0.5)] tracking-tight">
                ARRIVALS
              </h1>
              <p className="text-cyan-300/70 text-xl mt-1 font-medium">Next 6 incoming flights</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-6xl font-black text-cyan-400 drop-shadow-[0_0_20px_rgba(34,211,238,0.4)] tabular-nums">
                {currentTime || "--:--"}
              </div>
              {lastUpdate && <div className="text-sm text-cyan-300/60 mt-1">Updated: {lastUpdate}</div>}
            </div>
            <div className="w-4 h-4 rounded-full bg-emerald-400 shadow-[0_0_16px_rgba(52,211,153,0.8)] animate-pulse" />
          </div>
        </div>
      </div>

      <div className="w-full mx-auto flex-1 min-h-0">
        {loading && sortedFlights.length === 0 ? (
          <div className="text-center p-12 h-full flex items-center justify-center">
            <div className="inline-flex items-center gap-4">
              <div className="w-12 h-12 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-2xl text-cyan-300 font-medium">Loading arrivals...</span>
            </div>
          </div>
        ) : (
          <div className="bg-[#0f2744] rounded-3xl border-2 border-cyan-500/30 shadow-[0_0_40px_rgba(34,211,238,0.2)] overflow-hidden h-full flex flex-col">
            <div className="grid grid-cols-12 gap-2 p-4 bg-cyan-500/10 border-b-2 border-cyan-500/30 font-bold text-cyan-300 text-xl uppercase tracking-wider flex-shrink-0">
              {tableHeaders.map((header) => {
                const IconComponent = header.icon
                return (
                  <div key={header.label} className={`col-span-${header.span} flex items-center gap-2 justify-center`}>
                    <IconComponent className="w-6 h-6" />
                    <span>{header.label}</span>
                  </div>
                )
              })}
            </div>

            <div className="divide-y-2 divide-cyan-500/10 flex-1 overflow-y-auto">
              {sortedFlights.length === 0 ? (
                <div className="p-12 text-center text-cyan-300/60 h-full flex flex-col items-center justify-center">
                  <Plane className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <div className="text-2xl font-medium">No arrivals scheduled</div>
                </div>
              ) : (
                sortedFlights.map((flight, index) => {
                  const shouldBlink = shouldBlinkRow(flight)
                  const isCancelledFlight = isCancelled(flight)
                  const isDelayedFlight = isDelayed(flight)
                  const isEarlyFlight = isEarly(flight)
                  const flightawareLogoURL = getFlightawareLogoURL(flight.AirlineICAO)

                  return (
                    <div
                      key={`${flight.FlightNumber}-${index}-${flight.ScheduledDepartureTime}`}
                      className={`grid grid-cols-12 gap-2 p-4 items-center transition-all duration-300 hover:bg-cyan-500/5
                        ${shouldBlink ? "animate-row-blink" : ""}
                        ${index % 2 === 0 ? "bg-[#0a1f38]" : "bg-transparent"}`}
                      style={{ minHeight: "120px" }}
                    >
                      <div className="col-span-2 text-center">
                        <div className="text-[5rem] font-black text-white drop-shadow-[0_4px_8px_rgba(0,0,0,0.5)] tabular-nums leading-none">
                          {flight.ScheduledDepartureTime ? (
                            formatTime(flight.ScheduledDepartureTime)
                          ) : (
                            <span className="text-cyan-300/30">--:--</span>
                          )}
                        </div>
                      </div>

                      <div className="col-span-2 text-center">
                        {flight.EstimatedDepartureTime &&
                        flight.EstimatedDepartureTime !== flight.ScheduledDepartureTime ? (
                          <div className="text-[5rem] font-black text-cyan-400 drop-shadow-[0_4px_12px_rgba(34,211,238,0.6)] tabular-nums leading-none">
                            {formatTime(flight.EstimatedDepartureTime)}
                          </div>
                        ) : (
                          <div className="text-[5rem] font-black text-cyan-300/20 tabular-nums leading-none">-</div>
                        )}
                      </div>

                      <div className="col-span-3">
                        <div className="flex items-center gap-3 justify-center">
                          <div className="relative w-28 h-20 bg-white rounded-xl p-2 shadow-lg border-2 border-cyan-400/20 flex items-center justify-center">
                            <img
                              src={flightawareLogoURL || "/placeholder.svg"}
                              alt={`${flight.AirlineName} logo`}
                              className="object-contain w-full h-full"
                              onError={handleImageError}
                            />
                          </div>
                          <div>
                            <div className="text-[5rem] font-black text-white drop-shadow-[0_4px_8px_rgba(0,0,0,0.5)] leading-none">
                              {flight.FlightNumber}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="col-span-3 text-center">
                        <div className="text-[4.5rem] font-black text-cyan-400 drop-shadow-[0_4px_12px_rgba(34,211,238,0.6)] truncate leading-none">
                          {flight.DestinationCityName || flight.DestinationAirportName}
                        </div>
                      </div>

                      <div className="col-span-2">
                        <div className={`text-3xl font-bold ${getStatusColor(flight.StatusEN)}`}>
                          {isCancelledFlight ? (
                            <div className="flex items-center gap-2 bg-red-500/20 px-4 py-3 rounded-xl border-2 border-red-400/40 justify-center shadow-[0_0_20px_rgba(248,113,113,0.3)]">
                              <div className="flex gap-2 mr-2">
                                <LEDIndicator color="red" isActive={ledState} />
                                <LEDIndicator color="red" isActive={!ledState} />
                              </div>
                              <AlertCircle className="w-8 h-8 text-red-400" />
                              <span className="text-red-400 drop-shadow-[0_2px_8px_rgba(248,113,113,0.5)]">
                                Cancelled
                              </span>
                            </div>
                          ) : isDelayedFlight ? (
                            <div className="flex items-center gap-2 bg-amber-500/20 px-4 py-3 rounded-xl border-2 border-amber-400/40 justify-center shadow-[0_0_20px_rgba(251,191,36,0.3)]">
                              <div className="flex gap-2 mr-2">
                                <LEDIndicator color="orange" isActive={ledState} />
                                <LEDIndicator color="orange" isActive={!ledState} />
                              </div>
                              <AlertCircle className="w-8 h-8 text-amber-400" />
                              <span className="text-amber-400 drop-shadow-[0_2px_8px_rgba(251,191,36,0.5)]">
                                Delayed
                              </span>
                            </div>
                          ) : isEarlyFlight ? (
                            <div className="flex items-center gap-2 bg-emerald-500/20 px-4 py-3 rounded-xl border-2 border-emerald-400/40 justify-center shadow-[0_0_20px_rgba(52,211,153,0.3)]">
                              <div className="flex gap-2 mr-2">
                                <LEDIndicator color="green" isActive={ledState} />
                                <LEDIndicator color="green" isActive={!ledState} />
                              </div>
                              <span className="text-emerald-400 drop-shadow-[0_2px_8px_rgba(52,211,153,0.5)]">
                                Earlier
                              </span>
                            </div>
                          ) : flight.StatusEN?.toLowerCase().includes("arrived") ||
                            flight.StatusEN?.toLowerCase().includes("sletio") ? (
                            <div className="flex items-center gap-2 bg-emerald-500/20 px-4 py-3 rounded-xl border-2 border-emerald-400/40 justify-center shadow-[0_0_20px_rgba(52,211,153,0.3)]">
                              <div className="w-4 h-4 rounded-full bg-emerald-400 animate-blink shadow-[0_0_12px_rgba(52,211,153,0.8)]" />
                              <span className="text-emerald-400 drop-shadow-[0_2px_8px_rgba(52,211,153,0.5)]">
                                Arrived
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 justify-center px-4 py-3">
                              {shouldBlink && <Info className="w-8 h-8" />}
                              <span className="truncate drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">
                                {flight.StatusEN || "Scheduled"}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>

      <div className="w-full mx-auto mt-3 text-center flex-shrink-0">
        <div className="text-cyan-300/50 text-base py-2">
          <div className="flex items-center justify-center gap-3">
            <span>Next 6 arrivals</span>
            <span>•</span>
            <span>Auto Refresh :: Code by alen.vocanec@apm.co.me</span>
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0.3; }
        }
        @keyframes row-blink {
          0%, 50% { 
            background-color: rgba(34, 211, 238, 0.15);
            box-shadow: 0 0 30px rgba(34, 211, 238, 0.4);
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
          width: 8px;
        }
        ::-webkit-scrollbar-track {
          background: rgba(34, 211, 238, 0.1);
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb {
          background: rgba(34, 211, 238, 0.3);
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: rgba(34, 211, 238, 0.5);
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
  )
}
