"use client"

import type React from "react"
import { useEffect, useState, useRef } from "react"
import { useParams } from "next/navigation"
import type { Flight } from "@/types/flight"
import { fetchFlightData, getFlightsByBaggage } from "@/lib/flight-service"
import { Plane, Luggage, MapPin, Clock, Users } from "lucide-react"

export default function BaggagePage() {
  const params = useParams()
  const beltNumber = params.beltNumber as string
  const [flights, setFlights] = useState<Flight[]>([])
  const [lastUpdate, setLastUpdate] = useState<string>("")
  const [isUpdating, setIsUpdating] = useState(false)
  const isInitialLoad = useRef(true)

  useEffect(() => {
    const loadFlights = async () => {
      try {
        // Prvi load prikazuje loading, ostali su silent update
        if (isInitialLoad.current) {
          setIsUpdating(true)
        }

        console.log(`=== LOADING FLIGHTS FOR BELT ${beltNumber} ===`)
        
        const data = await fetchFlightData()
        
        const allArrivals = data.arrivals || []
        
        // Koristimo getFlightsByBaggage funkciju
        let baggageFlights = getFlightsByBaggage(data.arrivals, beltNumber)
        
        // Ako nema letova, pokušaj direktno
        if (baggageFlights.length === 0) {
          baggageFlights = allArrivals.filter(f => {
            const belt = f.BaggageReclaim
            return belt === beltNumber
          })
        }

        // Ako i dalje nema, pokušaj sa partial match
        if (baggageFlights.length === 0) {
          const normalizedBelt = beltNumber.replace(/^0+/, '')
          baggageFlights = allArrivals.filter(f => {
            const belt = f.BaggageReclaim
            if (!belt) return false
            
            const normalizedFlightBelt = belt.toString().replace(/^0+/, '')
            return normalizedFlightBelt === normalizedBelt || belt === beltNumber
          })
        }

        const now = new Date()
        const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000)

        // Filtriranje letova - prikaži samo aktivne letove ili arrived letove unutar 30 minuta
        const activeFlights = baggageFlights.filter((flight) => {
          const statusLower = flight.StatusEN?.toLowerCase() || ""
          const isArrived = statusLower.includes("arrived") || statusLower.includes("sletio") || statusLower.includes("landed")
          
          if (isArrived) {
            const flightTimeStr = flight.EstimatedDepartureTime || flight.ScheduledDepartureTime
            if (!flightTimeStr) return false
            
            const [hours, minutes] = flightTimeStr.split(':').map(Number)
            const flightTime = new Date(now)
            flightTime.setHours(hours, minutes, 0, 0)
            
            return flightTime.getTime() >= thirtyMinutesAgo.getTime()
          }
          
          return true
        })

        // Sortiraj po vremenu (najraniji prvi)
        activeFlights.sort((a, b) => {
          const timeA = a.EstimatedDepartureTime || a.ScheduledDepartureTime || "99:99"
          const timeB = b.EstimatedDepartureTime || b.ScheduledDepartureTime || "99:99"
          return timeA.localeCompare(timeB)
        })

        // Prikaži samo 5 letova
        const displayFlights = activeFlights.slice(0, 5)
        
        // Smooth transition - samo zamijeni podatke bez loading statea
        setFlights(displayFlights)
        
        const updateTime = new Date().toLocaleTimeString("en-GB", {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        })
        setLastUpdate(updateTime)
        
      } catch (error) {
        console.error("Failed to load arrivals:", error)
        // U slučaju greške, ne resetiramo flights - držimo postojeće podatke
      } finally {
        setIsUpdating(false)
        isInitialLoad.current = false
      }
    }

    loadFlights()
    const interval = setInterval(loadFlights, 60000)
    return () => clearInterval(interval)
  }, [beltNumber])

  const getStatusColor = (status: string): string => {
    const statusLower = status.toLowerCase()
    if (statusLower.includes("arrived") || statusLower.includes("sletio") || statusLower.includes("landed")) 
      return "text-emerald-400"
    if (statusLower.includes("approach") || statusLower.includes("final")) return "text-cyan-400"
    if (statusLower.includes("delay")) return "text-red-400"
    if (statusLower.includes("air") || statusLower.includes("flying")) return "text-blue-400"
    if (statusLower.includes("scheduled")) return "text-amber-400"
    if (statusLower.includes("cancelled") || statusLower.includes("otkazan")) return "text-red-400"
    return "text-gray-400"
  }

  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>): void => {
    const target = e.currentTarget
    target.src = "https://via.placeholder.com/180x120?text=No+Logo"
  }

  // Helper za prikaz vremena
  const getFlightTime = (flight: Flight) => {
    return flight.EstimatedDepartureTime || flight.ScheduledDepartureTime || "N/A"
  }

  // Check if flight is arrived and within 30 minutes
  const isRecentArrived = (flight: Flight): boolean => {
    const statusLower = flight.StatusEN.toLowerCase()
    const isArrived = statusLower.includes("arrived") || statusLower.includes("sletio") || statusLower.includes("landed")
    
    if (!isArrived) return false
    
    const now = new Date()
    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000)
    const flightTimeStr = flight.EstimatedDepartureTime || flight.ScheduledDepartureTime
    
    if (!flightTimeStr) return true
    
    const [hours, minutes] = flightTimeStr.split(':').map(Number)
    const flightTime = new Date(now)
    flightTime.setHours(hours, minutes, 0, 0)
    
    return flightTime.getTime() >= thirtyMinutesAgo.getTime()
  }

  // Check if flight is cancelled
  const isCancelled = (flight: Flight): boolean => {
    const statusLower = flight.StatusEN.toLowerCase()
    return statusLower.includes("cancelled") || statusLower.includes("otkazan")
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a0b2e] via-[#2d1b4e] to-[#1a0b2e] text-white p-8">
      {/* Update Indicator - samo kada se vrši background update */}
      {isUpdating && isInitialLoad.current === false && (
        <div className="fixed top-4 right-4 z-50">
          <div className="w-3 h-3 rounded-full bg-amber-400 animate-pulse shadow-[0_0_20px_rgba(251,191,36,0.8)]" />
        </div>
      )}

      <div className="max-w-[95%] mx-auto mb-8">
        <div className="flex justify-between items-center bg-gradient-to-r from-purple-900/40 to-indigo-900/40 backdrop-blur-xl rounded-3xl border-4 border-purple-500/30 p-8 shadow-2xl">
          <div className="flex items-center gap-2">
            <div className="p-4 bg-gradient-to-br from-amber-400 to-orange-500 rounded-3xl shadow-2xl">
              <Luggage className="w-20 h-20 text-white drop-shadow-lg" />
            </div>
            <div>
              <h1 className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-amber-400 to-orange-400 drop-shadow-[0_4px_12px_rgba(251,191,36,0.5)]">
                BAGGAGE CLAIM
              </h1>
              <p className="text-xl text-purple-300 font-semibold mt-2">
                Arrivals Only • Active + Recent Arrived • Belt {beltNumber}
              </p>
            </div>
          </div>
          <div className="text-center bg-gradient-to-br from-amber-400 to-orange-500 rounded-3xl p-8 shadow-2xl border-4 border-amber-300">
            <div className="text-[70px] font-black text-white leading-none drop-shadow-[0_8px_16px_rgba(0,0,0,0.5)]">
              {beltNumber}
            </div>
            <div className="text-3xl font-black text-white mt-2">BELT</div>
            {lastUpdate && (
              <div className="text-lg text-amber-100 mt-2 font-semibold">
                Updated: {lastUpdate}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-[95%] mx-auto">
        {isUpdating && isInitialLoad.current ? (
          // Initial loading state - samo na prvom učitavanju
          <div className="text-center p-16 bg-purple-900/20 backdrop-blur-xl rounded-3xl border-4 border-purple-500/30">
            <div className="inline-flex items-center gap-4">
              <div className="w-16 h-16 border-8 border-amber-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-4xl text-purple-200 font-bold">
                Loading arrivals for Belt {beltNumber}...
              </span>
            </div>
          </div>
        ) : flights.length === 0 ? (
          // No data state
          <div className="text-center p-16 bg-purple-900/20 backdrop-blur-xl rounded-3xl border-4 border-purple-500/30">
            <div className="flex flex-col items-center">
              <Plane className="w-32 h-32 mx-auto mb-6 text-purple-400 opacity-80 rotate-180" />
              <div className="text-5xl text-purple-300 mb-4 font-bold">
                No Active Arrivals
              </div>
              <div className="text-3xl text-purple-400 mb-6">
                Currently no active arrivals for Belt {beltNumber}
              </div>
              
              <div className="text-xl text-purple-300 bg-purple-800/50 p-4 rounded-xl">
                <div className="font-bold mb-2">Baggage claim shows:</div>
                <ul className="list-disc list-inside text-left space-y-1">
                  <li>Only arrival flights (not departures)</li>
                  <li>Active flights + arrived within last 30 minutes</li>
                  <li>Flights assigned to belt {beltNumber}</li>
                  <li>Next 5 upcoming arrivals</li>
                </ul>
              </div>
            </div>
          </div>
        ) : (
          // Data display - smooth transitions
          <div className="transition-all duration-300">
            <div className="bg-purple-900/20 backdrop-blur-xl rounded-3xl border-4 border-purple-500/30 shadow-2xl overflow-hidden">
              <div className="grid grid-cols-12 gap-6 p-6 bg-gradient-to-r from-purple-600 to-indigo-600 border-b-4 border-purple-500/50 font-black text-white text-2xl uppercase tracking-wider">
                <div className="col-span-2 flex items-center gap-2">
                  <Plane className="w-8 h-8" />
                  <span>Flight</span>
                </div>
                <div className="col-span-3 flex items-center gap-2">
                  <MapPin className="w-8 h-8" />
                  <span>Destination</span>
                </div>
                <div className="col-span-2 flex items-center gap-2">
                  <Clock className="w-8 h-8" />
                  <span>Time</span>
                </div>
                <div className="col-span-2">Status</div>
                <div className="col-span-2">Details</div>
                <div className="col-span-1 flex items-center gap-2">
                  <Luggage className="w-8 h-8" />
                  <span>Belt</span>
                </div>
              </div>

              <div className="divide-y-2 divide-purple-500/20">
                {flights.map((flight, index) => {
                  const isArrivedFlight = isRecentArrived(flight)
                  const isCancelledFlight = isCancelled(flight)
                  
                  return (
                    <div
                      key={`${flight.FlightNumber}-${index}-${flight.EstimatedDepartureTime || flight.ScheduledDepartureTime}`}
                      className={`grid grid-cols-12 gap-6 p-6 items-center transition-all duration-300 hover:bg-purple-500/10
                        ${isArrivedFlight ? 'bg-emerald-900/20' : ''}
                        ${isCancelledFlight ? 'bg-red-900/20' : ''}`}
                    >
                      {/* Flight Info */}
                      <div className="col-span-2">
                        <div className="flex items-center gap-3">
                          <img
                            src={flight.AirlineLogoURL || "/placeholder.svg"}
                            alt={flight.AirlineName}
                            className="w-16 h-16 object-contain bg-white rounded-xl p-2 shadow-lg"
                            onError={handleImageError}
                          />
                          <div>
                            <div className="text-5xl font-black text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)]">
                              {flight.FlightNumber}
                            </div>
                            <div className="text-xl text-purple-300 font-semibold">
                              {flight.AirlineName}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Destination */}
                      <div className="col-span-3">
                        <div className="text-6xl font-black text-white drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)]">
                          {flight.DestinationCityName || flight.DestinationAirportName || "Unknown"}
                        </div>
                        <div className="text-3xl font-black text-cyan-400 drop-shadow-[0_2px_8px_rgba(6,182,212,0.5)]">
                          {flight.DestinationAirportCode || "N/A"}
                        </div>
                      </div>

                      {/* Time */}
                      <div className="col-span-2">
                        <div className="text-6xl font-black text-amber-400 drop-shadow-[0_4px_12px_rgba(251,191,36,0.5)]">
                          {getFlightTime(flight)}
                        </div>
                        {flight.EstimatedDepartureTime &&
                          flight.EstimatedDepartureTime !== flight.ScheduledDepartureTime && (
                            <div className="text-2xl text-purple-400 line-through font-semibold">
                              {flight.ScheduledDepartureTime}
                            </div>
                          )}
                      </div>

                      {/* Status */}
                      <div className="col-span-2">
                        <div
                          className={`text-5xl font-black ${getStatusColor(flight.StatusEN)} drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)]`}
                        >
                          {flight.StatusEN}
                        </div>
                        {isArrivedFlight && (
                          <div className="text-lg text-emerald-300 mt-1">
                            (Recent - within 30 min)
                          </div>
                        )}
                      </div>

                      {/* Details */}
                      <div className="col-span-2">
                        <div className="flex flex-col gap-2">
                          {flight.CodeShareFlights && flight.CodeShareFlights.length > 0 && (
                            <div className="flex items-center gap-2 bg-cyan-500/30 px-4 py-2 rounded-xl border-2 border-cyan-400/50">
                              <Users className="w-6 h-6 text-cyan-300" />
                              <span className="text-2xl font-bold text-cyan-200">
                                +{flight.CodeShareFlights.length}
                              </span>
                            </div>
                          )}
                          {flight.Terminal && (
                            <div className="bg-orange-500/30 px-4 py-2 rounded-xl border-2 border-orange-400/50">
                              <div className="text-4xl font-black text-orange-300">
                                T{flight.Terminal.replace("T0", "").replace("T", "")}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Belt Number */}
                      <div className="col-span-1 text-center">
                        <div className="text-5xl font-black text-white bg-gradient-to-br from-amber-400 to-orange-500 py-4 rounded-2xl shadow-[0_0_30px_rgba(251,191,36,0.5)] border-2 border-amber-300">
                          {flight.BaggageReclaim || beltNumber}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {flights.length > 0 && (
        <div className="max-w-[95%] mx-auto mt-8">
          <div className="bg-gradient-to-r from-green-500/30 to-emerald-500/30 backdrop-blur-xl rounded-3xl border-4 border-green-400/50 p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Plane className="w-12 h-12 text-green-400 animate-pulse drop-shadow-[0_0_20px_rgba(52,211,153,0.8)] rotate-180" />
                <div>
                  <div className="text-4xl font-black text-green-300 drop-shadow-[0_2px_8px_rgba(52,211,153,0.5)]">
                    Baggage Claim Monitor
                  </div>
                  <div className="text-2xl text-green-200 font-semibold">
                    {flights.length} flight{flights.length > 1 ? 's' : ''} active • Belt {beltNumber}
                  </div>
                  <div className="text-lg text-green-300">
                    Shows active + arrived within 30 minutes • Code by alen.vocanec@apm.co.me
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xl text-green-300 font-semibold">Auto Refresh</div>
                <div className="text-3xl font-mono font-black text-green-400">
                  {lastUpdate.split(':').slice(0, 2).join(':')}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="max-w-[95%] mx-auto mt-8 text-center text-xl text-purple-400 font-semibold">
        <div className="flex items-center justify-center gap-6 mb-2">
          <span>Arrivals Only</span>
          <span>•</span>
          <span>Active + Recent Arrived (30 min)</span>
          <span>•</span>
          <span>Auto Refresh Every Minute</span>
        </div>
        <div>Showing up to 5 arrivals • Updates every minute</div>
      </div>
    </div>
  )
}