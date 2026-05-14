// 'use client';

// import { useEffect, useState, useCallback, useRef } from 'react';
// import { useRouter } from 'next/navigation';
// import {
//   RefreshCw,
//   Trash2,
//   LogOut,
//   Home,
//   CheckSquare,
//   GitBranch,
//   X,
//   Plane,
//   Clock,
//   Sun,
//   Moon,
// } from 'lucide-react';
// import type { Flight } from '@/types/flight';

// // ─────────────────────────────────────────────
// // Konstante
// // ─────────────────────────────────────────────

// const isDevelopment = process.env.NODE_ENV === 'development';
// const API_PREFIX    = isDevelopment ? '/api/test' : '/api/admin';

// const DESKS = [
//   ...Array.from({ length: 12 }, (_, i) => String(i + 1)),
//   '21', '22', '23', '24', '25', '26',
// ];
// const GATES = ['2','3','4','5','6','21','22','23','24','25','26','27','28','29','30','31'];

// const REFRESH_INTERVAL_MS = 60_000;

// // ─────────────────────────────────────────────
// // Tipovi
// // ─────────────────────────────────────────────

// interface Assignment {
//   resourceId:      string;
//   flightNumber:    string;
//   airlineName:     string;
//   destinationCity: string;
//   scheduledTime:   string;
//   assignedAt:      string;
// }

// type TabType = 'checkin' | 'gate';

// interface PendingOverride {
//   flight:        Flight;
//   resourceId:    string;
//   resourceType:  'desk' | 'gate';
//   existingFlight: string;
// }

// // ─────────────────────────────────────────────
// // Helpers
// // ─────────────────────────────────────────────

// const isDeparted = (flight: Flight): boolean => {
//   const s = (flight.StatusEN || '').toLowerCase();
//   return s.includes('departed') || s.includes('poletio');
// };

// const sortBySTD = (a: Flight, b: Flight) =>
//   (a.ScheduledDepartureTime || '').localeCompare(b.ScheduledDepartureTime || '');

// const processFlights = (departures: Flight[]): Flight[] =>
//   departures.filter(f => !isDeparted(f)).sort(sortBySTD);

// // ─────────────────────────────────────────────
// // Sub-komponente
// // ─────────────────────────────────────────────

// const Divider: React.FC<{ label: string; isDark: boolean }> = ({ label, isDark }) => (
//   <div className="flex items-center gap-3 mb-3">
//     <div className={`h-px flex-1 ${isDark ? 'bg-gradient-to-r from-transparent via-sky-500/30 to-transparent' : 'bg-gradient-to-r from-transparent via-sky-600/60 to-transparent'}`} />
//     <span className={`text-[10px] font-bold tracking-widest uppercase ${isDark ? 'text-blue-400' : 'text-blue-700'}`}>
//       {label}
//     </span>
//     <div className={`h-px flex-1 ${isDark ? 'bg-gradient-to-r from-transparent via-sky-500/30 to-transparent' : 'bg-gradient-to-r from-transparent via-sky-600/60 to-transparent'}`} />
//   </div>
// );

// interface ResourceCellProps {
//   id:            string;
//   occupied?:     Assignment;
//   type:          'desk' | 'gate';
//   flightReady:   boolean;
//   onDragOver:    (e: React.DragEvent) => void;
//   onDrop:        (e: React.DragEvent) => void;
//   onAssign:      () => void;
//   isDark:        boolean;
// }

// const ResourceCell: React.FC<ResourceCellProps> = ({
//   id, occupied, type, flightReady, onDragOver, onDrop, onAssign, isDark,
// }) => {
//   let variantClasses = '';
//   let textColor = '';
//   let subTextColor = '';

//   if (isDark) {
//     if (occupied) {
//       variantClasses = 'bg-red-500/10 border-red-500/40 hover:bg-red-500/20';
//       textColor = 'text-red-300';
//       subTextColor = 'text-red-400/80';
//     } else if (flightReady) {
//       variantClasses = type === 'desk'
//         ? 'bg-sky-500/20 border-sky-400/60 hover:bg-sky-500/30 shadow-md shadow-sky-500/15 animate-pulse-subtle'
//         : 'bg-emerald-500/20 border-emerald-400/60 hover:bg-emerald-500/30 shadow-md shadow-emerald-500/15 animate-pulse-subtle';
//       textColor = type === 'desk' ? 'text-sky-200' : 'text-emerald-200';
//       subTextColor = 'text-white/50';
//     } else {
//       variantClasses = type === 'desk'
//         ? 'bg-sky-500/5 border-sky-500/15 hover:bg-sky-500/12'
//         : 'bg-emerald-500/5 border-emerald-500/15 hover:bg-emerald-500/12';
//       textColor = type === 'desk' ? 'text-sky-400/70' : 'text-emerald-400/70';
//       subTextColor = 'text-white/15';
//     }
//   } else {
//     if (occupied) {
//       variantClasses = 'bg-red-100 border-red-400 hover:bg-red-200';
//       textColor = 'text-red-800';
//       subTextColor = 'text-red-700';
//     } else if (flightReady) {
//       variantClasses = type === 'desk'
//         ? 'bg-sky-200 border-sky-500 hover:bg-sky-300 shadow-md shadow-sky-300/50 animate-pulse-subtle'
//         : 'bg-emerald-200 border-emerald-500 hover:bg-emerald-300 shadow-md shadow-emerald-300/50 animate-pulse-subtle';
//       textColor = type === 'desk' ? 'text-sky-900' : 'text-emerald-900';
//       subTextColor = 'text-gray-700';
//     } else {
//       variantClasses = type === 'desk'
//         ? 'bg-sky-50 border-sky-200 hover:bg-sky-100'
//         : 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100';
//       textColor = type === 'desk' ? 'text-sky-700' : 'text-emerald-700';
//       subTextColor = 'text-gray-500';
//     }
//   }

//   const handleTouchEnd = (e: React.TouchEvent) => {
//     e.preventDefault();
//     e.stopPropagation();
//     onAssign();
//   };

//   return (
//     <div
//       onDragOver={onDragOver}
//       onDrop={onDrop}
//       onClick={onAssign}
//       onTouchEnd={handleTouchEnd}
//       className={`relative rounded-xl border text-center cursor-pointer transition-all duration-200 touch-manipulation select-none ${variantClasses}`}
//       style={{ padding: '12px 6px' }}
//     >
//       {flightReady && !occupied && (
//         <div
//           className={`absolute inset-0 rounded-xl opacity-30 animate-ping ${type === 'desk' ? 'bg-sky-400' : 'bg-emerald-400'}`}
//           style={{ animationDuration: '2s' }}
//         />
//       )}
//       <div className={`relative text-lg font-black leading-none ${textColor}`}>
//         {id}
//       </div>
//       <div className={`relative text-[9px] mt-1 font-mono truncate leading-tight ${subTextColor}`}>
//         {occupied ? occupied.flightNumber : flightReady ? 'tapni' : '·'}
//       </div>
//       {occupied && (
//         <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 ring-1 ring-gray-200 dark:ring-slate-950" />
//       )}
//     </div>
//   );
// };

// interface FlightRowProps {
//   flight:      Flight;
//   assigned:    boolean;
//   selected:    boolean;
//   onDragStart: (e: React.DragEvent) => void;
//   onSelect:    () => void;
//   isDark:      boolean;
// }

// const FlightRow: React.FC<FlightRowProps> = ({
//   flight, assigned, selected, onDragStart, onSelect, isDark,
// }) => {
//   let containerClasses = 'cursor-pointer rounded-xl border transition-all duration-150 select-none relative overflow-hidden ';
//   let flightNumberColor = '';
//   let timeColor = '';
//   let destColor = '';
//   let airlineColor = '';

//   if (isDark) {
//     if (selected) {
//       containerClasses += 'ring-2 ring-amber-400 bg-amber-500/15 border-amber-400/60 shadow-lg shadow-amber-500/20';
//       flightNumberColor = 'text-amber-200';
//       timeColor = 'text-amber-400/70';
//       destColor = 'text-amber-300/80';
//       airlineColor = 'text-amber-400/50';
//     } else if (assigned) {
//       containerClasses += 'bg-white/3 border-white/8 opacity-50';
//       flightNumberColor = 'text-white';
//       timeColor = 'text-white/35';
//       destColor = 'text-white/65';
//       airlineColor = 'text-white/25';
//     } else {
//       containerClasses += 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/25 active:scale-98';
//       flightNumberColor = 'text-white';
//       timeColor = 'text-white/35';
//       destColor = 'text-white/65';
//       airlineColor = 'text-white/25';
//     }
//   } else {
//     if (selected) {
//       containerClasses += 'ring-2 ring-amber-500 bg-amber-50 border-amber-400 shadow-md';
//       flightNumberColor = 'text-amber-900';
//       timeColor = 'text-amber-700';
//       destColor = 'text-amber-800';
//       airlineColor = 'text-amber-700/70';
//     } else if (assigned) {
//       containerClasses += 'bg-gray-100 border-gray-300 opacity-80';
//       flightNumberColor = 'text-gray-700';
//       timeColor = 'text-gray-500';
//       destColor = 'text-gray-600';
//       airlineColor = 'text-gray-500';
//     } else {
//       containerClasses += 'bg-white border-gray-200 hover:bg-gray-100 hover:border-gray-300 active:scale-98';
//       flightNumberColor = 'text-gray-900';
//       timeColor = 'text-gray-500';
//       destColor = 'text-gray-700';
//       airlineColor = 'text-gray-500';
//     }
//   }

//   const handleTouchEnd = (e: React.TouchEvent) => {
//     e.preventDefault();
//     e.stopPropagation();
//     onSelect();
//   };

//   return (
//     <div
//       draggable
//       onDragStart={onDragStart}
//       onClick={onSelect}
//       onTouchEnd={handleTouchEnd}
//       className={containerClasses}
//       style={{ padding: '11px 13px' }}
//     >
//       {selected && <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-400 rounded-l-xl" />}
//       <div className="flex items-center justify-between gap-2">
//         <span className={`font-mono font-bold text-sm tracking-tight ${flightNumberColor}`}>
//           {flight.FlightNumber}
//         </span>
//         <div className={`flex items-center gap-1 ${timeColor}`}>
//           <Clock size={10} />
//           <span className="text-[11px] font-mono">{flight.ScheduledDepartureTime}</span>
//         </div>
//       </div>
//       <div className={`text-[12px] truncate mt-0.5 ${destColor}`}>
//         {flight.DestinationCityName || flight.DestinationAirportCode}
//       </div>
//       <div className="flex items-center justify-between mt-1.5">
//         <span className={`text-[10px] truncate ${airlineColor}`}>
//           {flight.AirlineName}
//         </span>
//         {selected && (
//           <span className="text-[10px] font-bold text-amber-800 bg-amber-200 px-2 py-0.5 rounded-full flex-shrink-0">
//             ✓ ODABRAN — tapni šalter/GATE
//           </span>
//         )}
//         {!selected && assigned && (
//           <span className={`text-[9px] font-medium flex-shrink-0 ${isDark ? 'text-white/25' : 'text-gray-500'}`}>
//             dodijeljen
//           </span>
//         )}
//       </div>
//     </div>
//   );
// };

// interface AssignmentCardProps {
//   a:        Assignment;
//   type:     'desk' | 'gate';
//   onRemove: () => void;
//   isDark:   boolean;
// }

// const AssignmentCard: React.FC<AssignmentCardProps> = ({ a, type, onRemove, isDark }) => (
//   <div className={`
//     flex justify-between items-center rounded-lg border p-3
//     ${type === 'desk'
//       ? isDark ? 'bg-sky-500/5 border-sky-500/15' : 'bg-sky-100 border-sky-300'
//       : isDark ? 'bg-emerald-500/5 border-emerald-500/15' : 'bg-emerald-100 border-emerald-300'
//     }
//   `}>
//     <div className="min-w-0">
//       <div className={`text-xs font-bold tracking-wider mb-0.5 ${
//         type === 'desk'
//           ? (isDark ? 'text-sky-400' : 'text-sky-800')
//           : (isDark ? 'text-emerald-400' : 'text-emerald-800')
//       }`}>
//         {type === 'desk' ? 'ŠALTER' : 'GATE'} {a.resourceId}
//       </div>
//       <div className={`font-mono font-bold text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>
//         {a.flightNumber}
//       </div>
//       <div className={`text-[11px] truncate ${isDark ? 'text-white/40' : 'text-gray-600'}`}>
//         {a.destinationCity} · {a.scheduledTime}
//       </div>
//     </div>
//     <button
//       onClick={onRemove}
//       onTouchEnd={(e) => { e.preventDefault(); onRemove(); }}
//       className="ml-3 p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-100 dark:hover:bg-red-500/10 transition-colors flex-shrink-0"
//     >
//       <Trash2 size={14} />
//     </button>
//   </div>
// );

// // ─────────────────────────────────────────────
// // Inline potvrda (zamjena za confirm())
// // ─────────────────────────────────────────────

// interface ConfirmOverlayProps {
//   pending:   PendingOverride;
//   onConfirm: () => void;
//   onCancel:  () => void;
//   isDark:    boolean;
// }

// const ConfirmOverlay: React.FC<ConfirmOverlayProps> = ({ pending, onConfirm, onCancel, isDark }) => (
//   <div
//     className="fixed inset-0 z-50 flex items-center justify-center p-4"
//     style={{ background: 'rgba(0,0,0,0.6)' }}
//     onClick={onCancel}
//   >
//     <div
//       className={`rounded-2xl border p-5 max-w-sm w-full shadow-2xl ${
//         isDark ? 'bg-slate-900 border-white/15' : 'bg-white border-gray-200'
//       }`}
//       onClick={(e) => e.stopPropagation()}
//     >
//       <div className={`font-bold text-base mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
//         Zamijeniti dodjelu?
//       </div>
//       <div className={`text-sm mb-5 leading-relaxed ${isDark ? 'text-white/60' : 'text-gray-600'}`}>
//         {pending.resourceType === 'desk' ? 'Šalter' : 'Gate'}{' '}
//         <span className={`font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{pending.resourceId}</span>{' '}
//         je već dodijeljen letu{' '}
//         <span className={`font-mono font-bold ${isDark ? 'text-red-300' : 'text-red-700'}`}>{pending.existingFlight}</span>.
//         <br />
//         Zamijeniti sa{' '}
//         <span className={`font-mono font-bold ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>{pending.flight.FlightNumber}</span>?
//       </div>
//       <div className="flex gap-3">
//         <button
//           onClick={onCancel}
//           onTouchEnd={(e) => { e.preventDefault(); onCancel(); }}
//           className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
//             isDark
//               ? 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
//               : 'bg-gray-100 border-gray-200 text-gray-600 hover:bg-gray-200'
//           }`}
//         >
//           Odustani
//         </button>
//         <button
//           onClick={onConfirm}
//           onTouchEnd={(e) => { e.preventDefault(); onConfirm(); }}
//           className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-red-500 text-white transition-colors hover:bg-red-600 active:bg-red-700"
//         >
//           Zamijeni
//         </button>
//       </div>
//     </div>
//   </div>
// );

// // ─────────────────────────────────────────────
// // GLAVNA KOMPONENTA
// // ─────────────────────────────────────────────

// export default function AssignPanel() {
//   const router = useRouter();

//   const [activeTab,              setActiveTab]              = useState<TabType>('checkin');
//   const [flights,                setFlights]                = useState<Flight[]>([]);
//   const [loadingFlights,         setLoadingFlights]         = useState(true);
//   const [lastUpdate,             setLastUpdate]             = useState('');
//   const [checkinAssignments,     setCheckinAssignments]     = useState<Assignment[]>([]);
//   const [gateAssignments,        setGateAssignments]        = useState<Assignment[]>([]);
//   const [refreshing,             setRefreshing]             = useState(false);
//   const [draggedFlight,          setDraggedFlight]          = useState<string | null>(null);
//   const [selectedFlightForTouch, setSelectedFlightForTouch] = useState<Flight | null>(null);
//   const [tickSec,                setTickSec]                = useState(REFRESH_INTERVAL_MS / 1000);
//   const [pendingOverride,        setPendingOverride]        = useState<PendingOverride | null>(null);
//   const [isDark,                 setIsDark]                 = useState(true);

//   // ── Refs — uvijek svježe vrijednosti u async callback-ovima ──────────────
//   const flightsRef             = useRef<Flight[]>([]);
//   const selectedFlightRef      = useRef<Flight | null>(null);
//   const checkinAssignmentsRef  = useRef<Assignment[]>([]);
//   const gateAssignmentsRef     = useRef<Assignment[]>([]);
//   const touchTimeoutRef        = useRef<ReturnType<typeof setTimeout> | null>(null);

//   useEffect(() => { flightsRef.current = flights; }, [flights]);
//   useEffect(() => { checkinAssignmentsRef.current = checkinAssignments; }, [checkinAssignments]);
//   useEffect(() => { gateAssignmentsRef.current = gateAssignments; }, [gateAssignments]);

//   // Wrapper koji sinkronizira i state i ref — kritično za mobile touch
//   const setSelectedFlight = useCallback((flight: Flight | null) => {
//     selectedFlightRef.current = flight;
//     setSelectedFlightForTouch(flight);
//   }, []);

//   // ── Tema ─────────────────────────────────────────────────────────────────
//   useEffect(() => {
//     const stored = localStorage.getItem('theme');
//     const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
//     const shouldBeDark = stored === 'dark' || (stored === null && prefersDark);
//     setIsDark(shouldBeDark);
//     if (shouldBeDark) {
//       document.documentElement.classList.add('dark');
//     } else {
//       document.documentElement.classList.remove('dark');
//     }
//   }, []);

//   const toggleTheme = () => {
//     const newDark = !isDark;
//     setIsDark(newDark);
//     if (newDark) {
//       document.documentElement.classList.add('dark');
//       localStorage.setItem('theme', 'dark');
//     } else {
//       document.documentElement.classList.remove('dark');
//       localStorage.setItem('theme', 'light');
//     }
//   };

//   // ── API pozivi ────────────────────────────────────────────────────────────
//   const fetchFlightsData = useCallback(async (): Promise<Flight[]> => {
//     const res  = await fetch('/api/flights?nocache=' + Date.now());
//     const data = await res.json();
//     return processFlights(data.departures || []);
//   }, []);

//   const fetchFlights = useCallback(async () => {
//     try {
//       const sorted = await fetchFlightsData();
//       setFlights(sorted);
//       setLastUpdate(new Date().toLocaleTimeString('sr-Latn-RS'));
//     } catch (err) {
//       console.error('Error fetching flights:', err);
//     } finally {
//       setLoadingFlights(false);
//     }
//   }, [fetchFlightsData]);

//   const fetchCheckinAssignments = useCallback(async (currentFlights: Flight[]) => {
//     try {
//       const res = await fetch(`${API_PREFIX}/desk-status-override`);
//       if (!res.ok) return;
//       const data = await res.json();
//       const list: Assignment[] = [];
//       for (const [deskNumber, value] of Object.entries(data)) {
//         const parsed = typeof value === 'string' ? JSON.parse(value) : value as Record<string, unknown>;
//         if (parsed.flightNumber && parsed.status === 'open') {
//           const flight = currentFlights.find(f => f.FlightNumber === parsed.flightNumber);
//           list.push({
//             resourceId:      deskNumber,
//             flightNumber:    parsed.flightNumber as string,
//             airlineName:     flight?.AirlineName || '',
//             destinationCity: flight?.DestinationCityName || '',
//             scheduledTime:   flight?.ScheduledDepartureTime || '',
//             assignedAt:      parsed.setAt ? new Date(parsed.setAt as string).toLocaleTimeString() : 'unknown',
//           });
//         }
//       }
//       setCheckinAssignments(list);
//     } catch (err) { console.error(err); }
//   }, []);

//   const fetchGateAssignments = useCallback(async (currentFlights: Flight[]) => {
//     try {
//       const res = await fetch(`${API_PREFIX}/gate-status-override`);
//       if (!res.ok) return;
//       const data = await res.json();
//       const list: Assignment[] = [];
//       for (const [gateNumber, value] of Object.entries(data)) {
//         const parsed = typeof value === 'string' ? JSON.parse(value) : value as Record<string, unknown>;
//         if (parsed.flightNumber && parsed.status === 'open') {
//           const flight = currentFlights.find(f => f.FlightNumber === parsed.flightNumber);
//           list.push({
//             resourceId:      gateNumber,
//             flightNumber:    parsed.flightNumber as string,
//             airlineName:     flight?.AirlineName || '',
//             destinationCity: flight?.DestinationCityName || '',
//             scheduledTime:   flight?.ScheduledDepartureTime || '',
//             assignedAt:      parsed.setAt ? new Date(parsed.setAt as string).toLocaleTimeString() : 'unknown',
//           });
//         }
//       }
//       setGateAssignments(list);
//     } catch (err) { console.error(err); }
//   }, []);

//   const refreshAll = useCallback(async (currentFlights: Flight[]) => {
//     await Promise.all([
//       fetchCheckinAssignments(currentFlights),
//       fetchGateAssignments(currentFlights),
//     ]);
//   }, [fetchCheckinAssignments, fetchGateAssignments]);

//   useEffect(() => {
//     fetchFlights().then(() => refreshAll(flightsRef.current));
//   }, [fetchFlights, refreshAll]);

//   useEffect(() => {
//     const ticker = setInterval(() => {
//       setTickSec(prev => (prev <= 1 ? REFRESH_INTERVAL_MS / 1000 : prev - 1));
//     }, 1000);
//     const interval = setInterval(async () => {
//       setTickSec(REFRESH_INTERVAL_MS / 1000);
//       try {
//         const sorted = await fetchFlightsData();
//         setFlights(sorted);
//         setLastUpdate(new Date().toLocaleTimeString('sr-Latn-RS'));
//         await refreshAll(sorted);
//       } catch (err) { console.error('Silent refresh error:', err); }
//     }, REFRESH_INTERVAL_MS);
//     return () => {
//       clearInterval(ticker);
//       clearInterval(interval);
//     };
//   }, [fetchFlightsData, refreshAll]);

//   const handleRefresh = useCallback(async () => {
//     setRefreshing(true);
//     setTickSec(REFRESH_INTERVAL_MS / 1000);
//     try {
//       const sorted = await fetchFlightsData();
//       setFlights(sorted);
//       setLastUpdate(new Date().toLocaleTimeString('sr-Latn-RS'));
//       await refreshAll(sorted);
//     } catch (err) { console.error(err); }
//     finally { setRefreshing(false); }
//   }, [fetchFlightsData, refreshAll]);

//   // ── Drag & Drop ───────────────────────────────────────────────────────────
//   const onDragStart = (flightNumber: string) => (e: React.DragEvent) => {
//     setDraggedFlight(flightNumber);
//     e.dataTransfer.setData('text/plain', flightNumber);
//     e.dataTransfer.effectAllowed = 'copy';
//   };

//   const onDragOver = (e: React.DragEvent) => {
//     e.preventDefault();
//     e.dataTransfer.dropEffect = 'copy';
//   };

//   // ── Centralna logika dodjele — bez confirm(), čita iz ref-a ──────────────
//   const assignFlightToResource = useCallback(async (
//     flight: Flight,
//     resourceId: string,
//     resourceType: 'desk' | 'gate',
//   ): Promise<boolean> => {
//     const endpoint = resourceType === 'desk'
//       ? `${API_PREFIX}/desk-status-override`
//       : `${API_PREFIX}/gate-status-override`;
//     const payload = resourceType === 'desk'
//       ? { deskNumber: resourceId, action: 'open', flightNumber: flight.FlightNumber }
//       : { gateNumber: resourceId, action: 'open', flightNumber: flight.FlightNumber };

//     try {
//       const res = await fetch(endpoint, {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify(payload),
//       });
//       if (!res.ok) throw new Error('HTTP ' + res.status);
//       await refreshAll(flightsRef.current);
//       return true;
//     } catch (err) {
//       console.error('Greška pri dodjeli:', err);
//       return false;
//     }
//   }, [refreshAll]);

//   // ── Touch assign — koristi ref, ne state ─────────────────────────────────
//   const handleResourceTouchAssign = useCallback(async (
//     resourceId: string,
//     resourceType: 'desk' | 'gate',
//   ) => {
//     const flight = selectedFlightRef.current; // ← uvijek svježe, nema stale closure
//     if (!flight) return;

//     const assignments = resourceType === 'desk'
//       ? checkinAssignmentsRef.current
//       : gateAssignmentsRef.current;
//     const existing = assignments.find(a => a.resourceId === resourceId);

//     if (existing) {
//       // Prikaži inline UI umjesto confirm() — confirm() gubi state na iOS/Android
//       setPendingOverride({
//         flight,
//         resourceId,
//         resourceType,
//         existingFlight: existing.flightNumber,
//       });
//       return;
//     }

//     await assignFlightToResource(flight, resourceId, resourceType);
//     setSelectedFlight(null);
//     if (touchTimeoutRef.current) clearTimeout(touchTimeoutRef.current);
//   }, [assignFlightToResource, setSelectedFlight]);

//   // ── Potvrda zamjene (inline overlay) ─────────────────────────────────────
//   const handleConfirmOverride = useCallback(async () => {
//     const p = pendingOverride;
//     setPendingOverride(null);
//     if (!p) return;
//     await assignFlightToResource(p.flight, p.resourceId, p.resourceType);
//     setSelectedFlight(null);
//     if (touchTimeoutRef.current) clearTimeout(touchTimeoutRef.current);
//   }, [pendingOverride, assignFlightToResource, setSelectedFlight]);

//   // ── Drag drop handleri ────────────────────────────────────────────────────
//   const onDropCheckin = (deskNumber: string) => async (e: React.DragEvent) => {
//     e.preventDefault();
//     const fn = draggedFlight || e.dataTransfer.getData('text/plain');
//     setDraggedFlight(null);
//     const flight = flightsRef.current.find(f => f.FlightNumber === fn);
//     if (!flight) return;

//     const existing = checkinAssignmentsRef.current.find(a => a.resourceId === deskNumber);
//     if (existing) {
//       setPendingOverride({ flight, resourceId: deskNumber, resourceType: 'desk', existingFlight: existing.flightNumber });
//       return;
//     }
//     await assignFlightToResource(flight, deskNumber, 'desk');
//   };

//   const onDropGate = (gateNumber: string) => async (e: React.DragEvent) => {
//     e.preventDefault();
//     const fn = draggedFlight || e.dataTransfer.getData('text/plain');
//     setDraggedFlight(null);
//     const flight = flightsRef.current.find(f => f.FlightNumber === fn);
//     if (!flight) return;

//     const existing = gateAssignmentsRef.current.find(a => a.resourceId === gateNumber);
//     if (existing) {
//       setPendingOverride({ flight, resourceId: gateNumber, resourceType: 'gate', existingFlight: existing.flightNumber });
//       return;
//     }
//     await assignFlightToResource(flight, gateNumber, 'gate');
//   };

//   // ── Touch selekcija leta ──────────────────────────────────────────────────
//   const handleFlightTouchSelect = useCallback((flight: Flight) => {
//     setSelectedFlight(flight);
//     if (touchTimeoutRef.current) clearTimeout(touchTimeoutRef.current);
//     touchTimeoutRef.current = setTimeout(() => setSelectedFlight(null), 8000);
//   }, [setSelectedFlight]);

//   // ── Brisanje dodjela ──────────────────────────────────────────────────────
//   const handleRemoveCheckin = useCallback(async (deskNumber: string, flightNumber: string) => {
//     // Umjesto confirm() — u produkciji možete dodati ConfirmOverlay ako želite
//     try {
//       await fetch(`${API_PREFIX}/desk-status-override`, {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({ deskNumber, action: 'clear' }),
//       });
//       await fetchCheckinAssignments(flightsRef.current);
//     } catch {
//       console.error('Greška pri brisanju šaltera', deskNumber, flightNumber);
//     }
//   }, [fetchCheckinAssignments]);

//   const handleRemoveGate = useCallback(async (gateNumber: string, flightNumber: string) => {
//     try {
//       await fetch(`${API_PREFIX}/gate-status-override`, {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({ gateNumber, action: 'clear' }),
//       });
//       await fetchGateAssignments(flightsRef.current);
//     } catch {
//       console.error('Greška pri brisanju gate-a', gateNumber, flightNumber);
//     }
//   }, [fetchGateAssignments]);

//   const handleLogout = async () => {
//     await fetch('/api/admin/logout', { method: 'POST' }).catch(() => {});
//     router.push('/admin/login');
//   };

//   const isFlightAssigned = (flightNumber: string, tab: TabType) =>
//     tab === 'checkin'
//       ? checkinAssignments.some(a => a.flightNumber === flightNumber)
//       : gateAssignments.some(a => a.flightNumber === flightNumber);

//   // ── Loading state ─────────────────────────────────────────────────────────
//   if (loadingFlights) {
//     return (
//       <div className={`min-h-screen flex items-center justify-center ${isDark ? 'bg-slate-950' : 'bg-white'}`}>
//         <div className="text-center space-y-4">
//           <div className="w-10 h-10 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto" />
//           <div className={`text-sm tracking-widest uppercase ${isDark ? 'text-white/50' : 'text-gray-500'}`}>
//             Učitavanje
//           </div>
//         </div>
//       </div>
//     );
//   }

//   // ── Render helpers ────────────────────────────────────────────────────────
//   const flightList = (tab: TabType) => (
//     <div className="space-y-1.5 max-h-[62vh] overflow-y-auto pr-0.5 scrollbar-thin">
//       {flights.length === 0 && (
//         <div className={`text-center py-8 text-sm ${isDark ? 'text-white/20' : 'text-gray-400'}`}>
//           <Plane size={28} className="mx-auto mb-2 opacity-30" />
//           Nema aktivnih letova
//         </div>
//       )}
//       {flights.map(flight => (
//         <FlightRow
//           key={flight.FlightNumber + flight.ScheduledDepartureTime}
//           flight={flight}
//           assigned={isFlightAssigned(flight.FlightNumber, tab)}
//           selected={selectedFlightForTouch?.FlightNumber === flight.FlightNumber}
//           onDragStart={onDragStart(flight.FlightNumber)}
//           onSelect={() => handleFlightTouchSelect(flight)}
//           isDark={isDark}
//         />
//       ))}
//     </div>
//   );

//   const touchBanner = () => (
//     <div className="mb-4">
//       <div className={`rounded-xl border p-4 transition-all duration-300 ${
//         selectedFlightForTouch
//           ? isDark
//             ? 'bg-amber-500/10 border-amber-400/50 shadow-lg shadow-amber-500/10'
//             : 'bg-amber-50 border-amber-400 shadow-md'
//           : isDark
//             ? 'bg-slate-900 border-white/10'
//             : 'bg-gray-100 border-gray-300'
//       }`}>
//         <div className="flex items-stretch gap-3">
//           {/* Korak 1 */}
//           <div className={`flex-1 rounded-lg p-3 border-2 transition-all duration-200 text-center ${
//             !selectedFlightForTouch
//               ? isDark
//                 ? 'border-sky-400 bg-sky-500/15 shadow-md shadow-sky-500/20'
//                 : 'border-sky-500 bg-sky-50 shadow-md'
//               : isDark
//                 ? 'border-white/10 bg-white/3 opacity-40'
//                 : 'border-gray-300 bg-gray-200 opacity-60'
//           }`}>
//             <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-black mx-auto mb-2 ${
//               !selectedFlightForTouch
//                 ? isDark ? 'bg-sky-400 text-slate-900' : 'bg-sky-600 text-white'
//                 : isDark ? 'bg-white/10 text-white/30' : 'bg-gray-300 text-gray-500'
//             }`}>1</div>
//             <div className={`text-xs font-bold mb-1 ${
//               !selectedFlightForTouch
//                 ? (isDark ? 'text-sky-300' : 'text-sky-800')
//                 : (isDark ? 'text-white/30' : 'text-gray-500')
//             }`}>
//               Odaberi let
//             </div>
//             <div className={`text-[10px] leading-tight ${
//               !selectedFlightForTouch
//                 ? (isDark ? 'text-sky-400/80' : 'text-sky-700')
//                 : (isDark ? 'text-white/20' : 'text-gray-400')
//             }`}>
//               Tapni let iz liste lijevo
//             </div>
//           </div>

//           {/* Strelica */}
//           <div className="flex items-center flex-shrink-0 self-center">
//             <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
//               <path
//                 d="M4 10h12M12 6l4 4-4 4"
//                 stroke={selectedFlightForTouch ? '#f59e0b' : (isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.3)')}
//                 strokeWidth="1.5"
//                 strokeLinecap="round"
//                 strokeLinejoin="round"
//               />
//             </svg>
//           </div>

//           {/* Korak 2 */}
//           <div className={`flex-1 rounded-lg p-3 border-2 transition-all duration-200 text-center ${
//             selectedFlightForTouch
//               ? isDark
//                 ? 'border-amber-400 bg-amber-500/15 shadow-md shadow-amber-500/20'
//                 : 'border-amber-500 bg-amber-50 shadow-md'
//               : isDark
//                 ? 'border-white/10 bg-white/3 opacity-40'
//                 : 'border-gray-300 bg-gray-200 opacity-60'
//           }`}>
//             <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-black mx-auto mb-2 ${
//               selectedFlightForTouch
//                 ? isDark ? 'bg-amber-400 text-slate-900' : 'bg-amber-600 text-white'
//                 : isDark ? 'bg-white/10 text-white/30' : 'bg-gray-300 text-gray-500'
//             }`}>2</div>
//             <div className={`text-xs font-bold mb-1 ${
//               selectedFlightForTouch
//                 ? (isDark ? 'text-amber-300' : 'text-amber-800')
//                 : (isDark ? 'text-white/30' : 'text-gray-500')
//             }`}>
//               Tapni šalter / gate
//             </div>
//             <div className={`text-[10px] leading-tight ${
//               selectedFlightForTouch
//                 ? (isDark ? 'text-amber-400/80' : 'text-amber-700')
//                 : (isDark ? 'text-white/20' : 'text-gray-400')
//             }`}>
//               {selectedFlightForTouch
//                 ? `"${selectedFlightForTouch.FlightNumber}" spreman`
//                 : 'Čeka se odabir leta'}
//             </div>
//           </div>
//         </div>

//         {selectedFlightForTouch && (
//           <div className="mt-3 flex items-center justify-between bg-amber-500/20 border border-amber-400/40 rounded-lg px-3 py-2">
//             <div className="flex items-center gap-2 min-w-0">
//               <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
//               <span className={`font-mono font-bold text-sm flex-shrink-0 ${isDark ? 'text-amber-200' : 'text-amber-800'}`}>
//                 {selectedFlightForTouch.FlightNumber}
//               </span>
//               <span className={`text-xs truncate ${isDark ? 'text-amber-400/70' : 'text-amber-700'}`}>
//                 {selectedFlightForTouch.DestinationCityName || selectedFlightForTouch.DestinationAirportCode}
//                 {selectedFlightForTouch.ScheduledDepartureTime && ` · ${selectedFlightForTouch.ScheduledDepartureTime}`}
//               </span>
//             </div>
//             <button
//               onClick={() => {
//                 setSelectedFlight(null);
//                 if (touchTimeoutRef.current) clearTimeout(touchTimeoutRef.current);
//               }}
//               onTouchEnd={(e) => {
//                 e.preventDefault();
//                 setSelectedFlight(null);
//                 if (touchTimeoutRef.current) clearTimeout(touchTimeoutRef.current);
//               }}
//               className="flex items-center gap-1 text-[10px] text-amber-400/60 hover:text-amber-300 transition-colors px-2 py-1 rounded hover:bg-amber-500/10 flex-shrink-0 ml-2"
//             >
//               <X size={11} /> Odustani
//             </button>
//           </div>
//         )}
//       </div>
//     </div>
//   );

//   // ── JSX ───────────────────────────────────────────────────────────────────
//   return (
//     <div className={`min-h-screen p-4 overflow-y-auto ${isDark ? 'bg-slate-950 text-white' : 'bg-white text-gray-900'}`}>

//       {/* Inline confirm overlay — zamjena za confirm() koji ne radi na mobilnom */}
//       {pendingOverride && (
//         <ConfirmOverlay
//           pending={pendingOverride}
//           onConfirm={handleConfirmOverride}
//           onCancel={() => setPendingOverride(null)}
//           isDark={isDark}
//         />
//       )}

//       <div className="max-w-7xl mx-auto">

//         {/* Header */}
//         <div className="flex items-start justify-between gap-4 mb-6">
//           <div>
//             <h1 className="text-xl font-bold tracking-tight">TIV · Check-in &amp; Gate</h1>
//             <div className="flex items-center gap-3 mt-1">
//               <span className={`text-xs ${isDark ? 'text-white/30' : 'text-gray-500'}`}>
//                 Letovi: {flights.length}
//               </span>
//               <span className={`text-xs ${isDark ? 'text-white/15' : 'text-gray-300'}`}>·</span>
//               <span className={`text-xs ${isDark ? 'text-white/30' : 'text-gray-500'}`}>
//                 Ažurirano: {lastUpdate || '—'}
//               </span>
//               <span className={`text-xs ${isDark ? 'text-white/15' : 'text-gray-300'}`}>·</span>
//               <span className={`text-xs tabular-nums ${isDark ? 'text-white/25' : 'text-gray-500'}`}>
//                 Refresh za {tickSec}s
//               </span>
//             </div>
//           </div>
//           <div className="flex items-center gap-2 flex-shrink-0">
//             <button
//               onClick={handleRefresh}
//               disabled={refreshing}
//               className={`p-2 rounded-lg border transition-colors disabled:opacity-40 ${
//                 isDark
//                   ? 'bg-white/5 hover:bg-white/10 border-white/8'
//                   : 'bg-gray-100 hover:bg-gray-200 border-gray-300'
//               }`}
//             >
//               <RefreshCw
//                 size={15}
//                 className={`${isDark ? 'text-white/60' : 'text-gray-600'} ${refreshing ? 'animate-spin' : ''}`}
//               />
//             </button>
//             <button
//               onClick={() => router.push('/admin')}
//               className={`p-2 rounded-lg border transition-colors ${
//                 isDark
//                   ? 'bg-white/5 hover:bg-white/10 border-white/8'
//                   : 'bg-gray-100 hover:bg-gray-200 border-gray-300'
//               }`}
//             >
//               <Home size={15} className={isDark ? 'text-white/60' : 'text-gray-600'} />
//             </button>
//             <button
//               onClick={toggleTheme}
//               className={`p-2 rounded-lg border transition-colors ${
//                 isDark
//                   ? 'bg-white/5 hover:bg-white/10 border-white/8'
//                   : 'bg-gray-100 hover:bg-gray-200 border-gray-300'
//               }`}
//             >
//               {isDark
//                 ? <Sun size={15} className="text-yellow-400" />
//                 : <Moon size={15} className="text-slate-700" />}
//             </button>
//             <button
//               onClick={handleLogout}
//               className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs transition-colors"
//             >
//               <LogOut size={13} /> Odjava
//             </button>
//           </div>
//         </div>

//         {/* Tabovi */}
//         <div className="flex gap-2 mb-5">
//           {[
//             {
//               id: 'checkin' as TabType,
//               label: 'Check-in',
//               icon: CheckSquare,
//               count: checkinAssignments.length,
//               activeClass: isDark
//                 ? 'bg-sky-500/15 border-sky-500/40 text-sky-300'
//                 : 'bg-sky-100 border-sky-400 text-sky-800 shadow-sm',
//             },
//             {
//               id: 'gate' as TabType,
//               label: 'Gate-ovi',
//               icon: GitBranch,
//               count: gateAssignments.length,
//               activeClass: isDark
//                 ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
//                 : 'bg-emerald-100 border-emerald-400 text-emerald-800 shadow-sm',
//             },
//           ].map(tab => {
//             const Icon = tab.icon;
//             const isActive = activeTab === tab.id;
//             return (
//               <button
//                 key={tab.id}
//                 onClick={() => setActiveTab(tab.id)}
//                 className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all duration-150 ${
//                   isActive
//                     ? tab.activeClass
//                     : isDark
//                       ? 'bg-white/3 border-white/8 text-white/40 hover:bg-white/8 hover:text-white/60'
//                       : 'bg-gray-100 border-gray-300 text-gray-500 hover:bg-gray-200 hover:text-gray-700'
//                 }`}
//               >
//                 <Icon size={14} /> {tab.label}
//                 <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
//                   isActive
//                     ? (isDark ? 'bg-white/20' : 'bg-white/80 text-gray-800')
//                     : (isDark ? 'bg-white/8 text-white/30' : 'bg-gray-200 text-gray-500')
//                 }`}>
//                   {tab.count}
//                 </span>
//               </button>
//             );
//           })}
//         </div>

//         {/* ── CHECK-IN TAB ─────────────────────────────────────────────────── */}
//         {activeTab === 'checkin' && (
//           <>
//             {touchBanner()}
//             <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

//               {/* Lista letova */}
//               <div className={`rounded-xl border p-3 ${isDark ? 'bg-white/3 border-white/8' : 'bg-gray-50 border-gray-300 shadow-sm'}`}>
//                 <div className={`text-[10px] font-bold tracking-widest uppercase mb-3 px-1 ${isDark ? 'text-white/30' : 'text-gray-500'}`}>
//                   Letovi ({flights.length})
//                 </div>
//                 {flightList('checkin')}
//               </div>

//               {/* Šalteri + Dodjele */}
//               <div className="lg:col-span-2 space-y-4">
//                 <div className={`rounded-xl border p-4 ${isDark ? 'bg-white/3 border-white/8' : 'bg-gray-50 border-gray-300 shadow-sm'}`}>
//                   <div className={`text-[10px] font-bold tracking-widest uppercase mb-4 ${isDark ? 'text-white/30' : 'text-gray-500'}`}>
//                     Šalteri
//                   </div>
//                   <div className="mb-5">
//                     <Divider label="Terminal 1" isDark={isDark} />
//                     <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-6 xl:grid-cols-8 gap-2">
//                       {DESKS.filter(d => parseInt(d) <= 12).map(desk => (
//                         <ResourceCell
//                           key={desk}
//                           id={desk}
//                           type="desk"
//                           occupied={checkinAssignments.find(a => a.resourceId === desk)}
//                           flightReady={!!selectedFlightForTouch && !checkinAssignments.find(a => a.resourceId === desk)}
//                           onDragOver={onDragOver}
//                           onDrop={onDropCheckin(desk)}
//                           onAssign={() => handleResourceTouchAssign(desk, 'desk')}
//                           isDark={isDark}
//                         />
//                       ))}
//                     </div>
//                   </div>
//                   <div>
//                     <Divider label="Terminal 2" isDark={isDark} />
//                     <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
//                       {DESKS.filter(d => parseInt(d) >= 21).map(desk => (
//                         <ResourceCell
//                           key={desk}
//                           id={desk}
//                           type="desk"
//                           occupied={checkinAssignments.find(a => a.resourceId === desk)}
//                           flightReady={!!selectedFlightForTouch && !checkinAssignments.find(a => a.resourceId === desk)}
//                           onDragOver={onDragOver}
//                           onDrop={onDropCheckin(desk)}
//                           onAssign={() => handleResourceTouchAssign(desk, 'desk')}
//                           isDark={isDark}
//                         />
//                       ))}
//                     </div>
//                   </div>
//                 </div>

//                 <div className={`rounded-xl border p-4 ${isDark ? 'bg-white/3 border-white/8' : 'bg-gray-50 border-gray-300 shadow-sm'}`}>
//                   <div className={`text-[10px] font-bold tracking-widest uppercase mb-3 ${isDark ? 'text-white/30' : 'text-gray-500'}`}>
//                     Aktivne dodjele ({checkinAssignments.length})
//                   </div>
//                   {checkinAssignments.length === 0
//                     ? <div className={`text-sm text-center py-4 ${isDark ? 'text-white/20' : 'text-gray-400'}`}>Nema dodjela</div>
//                     : <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
//                         {checkinAssignments.map(a => (
//                           <AssignmentCard
//                             key={a.resourceId}
//                             a={a}
//                             type="desk"
//                             onRemove={() => handleRemoveCheckin(a.resourceId, a.flightNumber)}
//                             isDark={isDark}
//                           />
//                         ))}
//                       </div>
//                   }
//                 </div>
//               </div>
//             </div>
//           </>
//         )}

//         {/* ── GATE TAB ─────────────────────────────────────────────────────── */}
//         {activeTab === 'gate' && (
//           <>
//             {touchBanner()}
//             <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

//               {/* Lista letova */}
//               <div className={`rounded-xl border p-3 ${isDark ? 'bg-white/3 border-white/8' : 'bg-gray-50 border-gray-300 shadow-sm'}`}>
//                 <div className={`text-[10px] font-bold tracking-widest uppercase mb-3 px-1 ${isDark ? 'text-white/30' : 'text-gray-500'}`}>
//                   Letovi ({flights.length})
//                 </div>
//                 {flightList('gate')}
//               </div>

//               {/* Gate-ovi + Dodjele */}
//               <div className="lg:col-span-2 space-y-4">
//                 <div className={`rounded-xl border p-4 ${isDark ? 'bg-white/3 border-white/8' : 'bg-gray-50 border-gray-300 shadow-sm'}`}>
//                   <div className={`text-[10px] font-bold tracking-widest uppercase mb-4 ${isDark ? 'text-white/30' : 'text-gray-500'}`}>
//                     Gate-ovi
//                   </div>
//                   <div className="mb-5">
//                     <Divider label="Terminal 1" isDark={isDark} />
//                     <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
//                       {GATES.filter(g => parseInt(g) >= 2 && parseInt(g) <= 6).map(gate => (
//                         <ResourceCell
//                           key={gate}
//                           id={gate}
//                           type="gate"
//                           occupied={gateAssignments.find(a => a.resourceId === gate)}
//                           flightReady={!!selectedFlightForTouch && !gateAssignments.find(a => a.resourceId === gate)}
//                           onDragOver={onDragOver}
//                           onDrop={onDropGate(gate)}
//                           onAssign={() => handleResourceTouchAssign(gate, 'gate')}
//                           isDark={isDark}
//                         />
//                       ))}
//                     </div>
//                   </div>
//                   <div>
//                     <Divider label="Terminal 2" isDark={isDark} />
//                     <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
//                       {GATES.filter(g => parseInt(g) >= 21 && parseInt(g) <= 28).map(gate => (
//                         <ResourceCell
//                           key={gate}
//                           id={gate}
//                           type="gate"
//                           occupied={gateAssignments.find(a => a.resourceId === gate)}
//                           flightReady={!!selectedFlightForTouch && !gateAssignments.find(a => a.resourceId === gate)}
//                           onDragOver={onDragOver}
//                           onDrop={onDropGate(gate)}
//                           onAssign={() => handleResourceTouchAssign(gate, 'gate')}
//                           isDark={isDark}
//                         />
//                       ))}
//                     </div>
//                   </div>
//                 </div>

//                 <div className={`rounded-xl border p-4 ${isDark ? 'bg-white/3 border-white/8' : 'bg-gray-50 border-gray-300 shadow-sm'}`}>
//                   <div className={`text-[10px] font-bold tracking-widest uppercase mb-3 ${isDark ? 'text-white/30' : 'text-gray-500'}`}>
//                     Aktivne dodjele ({gateAssignments.length})
//                   </div>
//                   {gateAssignments.length === 0
//                     ? <div className={`text-sm text-center py-4 ${isDark ? 'text-white/20' : 'text-gray-400'}`}>Nema dodjela</div>
//                     : <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
//                         {gateAssignments.map(a => (
//                           <AssignmentCard
//                             key={a.resourceId}
//                             a={a}
//                             type="gate"
//                             onRemove={() => handleRemoveGate(a.resourceId, a.flightNumber)}
//                             isDark={isDark}
//                           />
//                         ))}
//                       </div>
//                   }
//                 </div>
//               </div>
//             </div>
//           </>
//         )}
//       </div>

//       <style jsx global>{`
//         html, body, #__next { overflow: auto !important; height: auto !important; min-height: 100vh; }
//         .touch-manipulation { touch-action: manipulation; }
//         .scrollbar-thin::-webkit-scrollbar { width: 3px; }
//         .scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
//         .scrollbar-thin::-webkit-scrollbar-thumb {
//           background: ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.2)'};
//           border-radius: 2px;
//         }
//         @keyframes pulse-subtle { 0%, 100% { opacity: 1; } 50% { opacity: 0.75; } }
//         .animate-pulse-subtle { animation: pulse-subtle 1.8s ease-in-out infinite; }
//         .active\\:scale-98:active { transform: scale(0.98); }
//       `}</style>
//     </div>
//   );
// }
'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  RefreshCw,
  Trash2,
  LogOut,
  Home,
  CheckSquare,
  GitBranch,
  X,
  Plane,
  Clock,
  Sun,
  Moon,
  Fingerprint,
} from 'lucide-react';
import type { Flight } from '@/types/flight';

// ─────────────────────────────────────────────
// Konstante
// ─────────────────────────────────────────────

const API_PREFIX = '/api/test';

const DESKS = [
  ...Array.from({ length: 12 }, (_, i) => String(i + 1)),
  '21', '22', '23', '24', '25', '26',
];
const GATES = ['2', '3', '4', '5', '6', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31'];

const REFRESH_INTERVAL_MS = 60_000;
const TOUCH_TIMEOUT_MS = 8000;

// Klase putnika
const PASSENGER_CLASSES = [
  { key: 'ECONOMY',  label: 'Economy',  emoji: '💺', dark: 'bg-blue-600 border-blue-400 text-white',   light: 'bg-blue-600 border-blue-400 text-white'   },
  { key: 'BUSINESS', label: 'Business', emoji: '💼', dark: 'bg-orange-600 border-orange-400 text-white', light: 'bg-orange-600 border-orange-400 text-white' },
  { key: 'PREMIUM',  label: 'Premium',  emoji: '👑', dark: 'bg-purple-600 border-purple-400 text-white', light: 'bg-purple-600 border-purple-400 text-white' },
  { key: 'PRIORITY', label: 'Priority', emoji: '⭐', dark: 'bg-green-600 border-green-400 text-white',  light: 'bg-green-600 border-green-400 text-white'  },
] as const;

type ClassKey = typeof PASSENGER_CLASSES[number]['key'];

// ─────────────────────────────────────────────
// Tipovi
// ─────────────────────────────────────────────

interface Assignment {
  resourceId: string;
  flightNumber: string;
  airlineName: string;
  destinationCity: string;
  scheduledTime: string;
  assignedAt: string;
  classType: string | null;
}

type TabType = 'checkin' | 'gate';

interface PendingOverride {
  flight: Flight;
  resourceId: string;
  resourceType: 'desk' | 'gate';
  existingFlight: string;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const isDeparted = (flight: Flight): boolean => {
  const s = (flight.StatusEN || '').toLowerCase();
  return s.includes('departed') || s.includes('poletio');
};

const sortBySTD = (a: Flight, b: Flight) =>
  (a.ScheduledDepartureTime || '').localeCompare(b.ScheduledDepartureTime || '');

const processFlights = (departures: Flight[]): Flight[] =>
  departures.filter(f => !isDeparted(f)).sort(sortBySTD);

const classBadgeStyle = (classType: string | null, isDark: boolean): string => {
  const found = PASSENGER_CLASSES.find(c => c.key === classType);
  if (!found) return isDark ? 'bg-white/10 text-white/40' : 'bg-gray-200 text-gray-500';
  return isDark ? found.dark : found.light;
};

// ─────────────────────────────────────────────
// TouchFeedback
// ─────────────────────────────────────────────
const TouchFeedback = ({
  children,
  onTap,
  disabled,
}: {
  children: React.ReactNode;
  onTap: () => void;
  disabled?: boolean;
}) => {
  const [ripple, setRipple] = useState(false);

  const handleTouch = (e: React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    setRipple(true);
    onTap();
    setTimeout(() => setRipple(false), 150);
  };

  return (
    <div
      onTouchEnd={handleTouch}
      onClick={!disabled ? onTap : undefined}
      className={`relative transition-all duration-150 ${ripple ? 'scale-95' : 'scale-100'}`}
      style={{ touchAction: 'manipulation' }}
    >
      {ripple && (
        <div
          className="absolute inset-0 bg-white/20 rounded-xl animate-ping"
          style={{ animationDuration: '300ms' }}
        />
      )}
      {children}
    </div>
  );
};

// ─────────────────────────────────────────────
// ResourceCell
// ─────────────────────────────────────────────
interface ResourceCellProps {
  id: string;
  occupied?: Assignment;
  type: 'desk' | 'gate';
  flightReady: boolean;
  onAssign: () => void;
  isDark: boolean;
}

const ResourceCell: React.FC<ResourceCellProps> = ({
  id, occupied, type, flightReady, onAssign, isDark,
}) => {
  const baseClasses =
    'relative rounded-xl border text-center cursor-pointer transition-all duration-200 touch-manipulation select-none min-h-[70px] flex flex-col items-center justify-center';

  let variantClasses = '';
  let textColor = '';
  let subTextColor = '';

  if (isDark) {
    if (occupied) {
      variantClasses = 'bg-red-500/20 border-red-500/50';
      textColor = 'text-red-300';
      subTextColor = 'text-red-400/80';
    } else if (flightReady) {
      variantClasses =
        type === 'desk'
          ? 'bg-sky-500/30 border-sky-400/70 shadow-lg shadow-sky-500/30 animate-pulse-subtle'
          : 'bg-emerald-500/30 border-emerald-400/70 shadow-lg shadow-emerald-500/30 animate-pulse-subtle';
      textColor = type === 'desk' ? 'text-sky-200' : 'text-emerald-200';
      subTextColor = 'text-white/70';
    } else {
      variantClasses =
        type === 'desk'
          ? 'bg-sky-500/10 border-sky-500/30'
          : 'bg-emerald-500/10 border-emerald-500/30';
      textColor = type === 'desk' ? 'text-sky-400/80' : 'text-emerald-400/80';
      subTextColor = 'text-white/30';
    }
  } else {
    if (occupied) {
      variantClasses = 'bg-red-200 border-red-500';
      textColor = 'text-red-900';
      subTextColor = 'text-red-800';
    } else if (flightReady) {
      variantClasses =
        type === 'desk'
          ? 'bg-sky-300 border-sky-600 shadow-lg'
          : 'bg-emerald-300 border-emerald-600 shadow-lg';
      textColor = type === 'desk' ? 'text-sky-900' : 'text-emerald-900';
      subTextColor = 'text-gray-800';
    } else {
      variantClasses =
        type === 'desk'
          ? 'bg-sky-100 border-sky-300'
          : 'bg-emerald-100 border-emerald-300';
      textColor = type === 'desk' ? 'text-sky-800' : 'text-emerald-800';
      subTextColor = 'text-gray-600';
    }
  }

  return (
    <TouchFeedback onTap={onAssign} disabled={!!occupied}>
      <div className={`${baseClasses} ${variantClasses}`} style={{ padding: '12px 4px' }}>
        {flightReady && !occupied && (
          <div
            className={`absolute inset-0 rounded-xl opacity-40 animate-ping ${
              type === 'desk' ? 'bg-sky-400' : 'bg-emerald-400'
            }`}
            style={{ animationDuration: '1.5s' }}
          />
        )}
        <div className={`relative text-xl font-black leading-none ${textColor}`}>{id}</div>
        <div className={`relative text-[10px] mt-1.5 font-mono truncate max-w-full px-1 ${subTextColor}`}>
          {occupied ? occupied.flightNumber : flightReady ? '📱 TAPNI' : '⚫'}
        </div>
        {occupied && (
          <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-red-500 ring-2 ring-white dark:ring-slate-900" />
        )}
      </div>
    </TouchFeedback>
  );
};

// ─────────────────────────────────────────────
// FlightRow
// ─────────────────────────────────────────────
interface FlightRowProps {
  flight: Flight;
  assigned: boolean;
  selected: boolean;
  onSelect: () => void;
  isDark: boolean;
}

const FlightRow: React.FC<FlightRowProps> = ({
  flight, assigned, selected, onSelect, isDark,
}) => {
  let containerClasses =
    'cursor-pointer rounded-xl border transition-all duration-150 select-none relative overflow-hidden min-h-[85px] ';
  let flightNumberColor = '';
  let timeColor = '';
  let destColor = '';
  let airlineColor = '';

  if (isDark) {
    if (selected) {
      containerClasses +=
        'ring-2 ring-amber-400 bg-amber-500/20 border-amber-400/70 shadow-lg shadow-amber-500/30';
      flightNumberColor = 'text-amber-200';
      timeColor = 'text-amber-400/80';
      destColor = 'text-amber-300/90';
      airlineColor = 'text-amber-400/60';
    } else if (assigned) {
      containerClasses += 'bg-white/5 border-white/15 opacity-60';
      flightNumberColor = 'text-white/70';
      timeColor = 'text-white/40';
      destColor = 'text-white/60';
      airlineColor = 'text-white/30';
    } else {
      containerClasses += 'bg-white/8 border-white/20 hover:bg-white/15 active:scale-98';
      flightNumberColor = 'text-white';
      timeColor = 'text-white/40';
      destColor = 'text-white/70';
      airlineColor = 'text-white/35';
    }
  } else {
    if (selected) {
      containerClasses += 'ring-2 ring-amber-500 bg-amber-100 border-amber-500 shadow-md';
      flightNumberColor = 'text-amber-900';
      timeColor = 'text-amber-700';
      destColor = 'text-amber-800';
      airlineColor = 'text-amber-700/70';
    } else if (assigned) {
      containerClasses += 'bg-gray-100 border-gray-300 opacity-70';
      flightNumberColor = 'text-gray-700';
      timeColor = 'text-gray-500';
      destColor = 'text-gray-600';
      airlineColor = 'text-gray-500';
    } else {
      containerClasses += 'bg-white border-gray-200 hover:bg-gray-100 active:scale-98';
      flightNumberColor = 'text-gray-900';
      timeColor = 'text-gray-500';
      destColor = 'text-gray-700';
      airlineColor = 'text-gray-500';
    }
  }

  return (
    <TouchFeedback onTap={onSelect}>
      <div className={containerClasses} style={{ padding: '12px 16px' }}>
        {selected && (
          <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-amber-400 rounded-l-xl" />
        )}
        <div className="flex items-center justify-between gap-3">
          <span className={`font-mono font-bold text-base tracking-tight ${flightNumberColor}`}>
            {flight.FlightNumber}
          </span>
          <div className={`flex items-center gap-1.5 ${timeColor}`}>
            <Clock size={12} />
            <span className="text-xs font-mono">{flight.ScheduledDepartureTime}</span>
          </div>
        </div>
        <div className={`text-sm truncate mt-1 font-medium ${destColor}`}>
          {flight.DestinationCityName || flight.DestinationAirportCode}
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <span className={`text-[11px] truncate ${airlineColor}`}>{flight.AirlineName}</span>
          {selected && (
            <span className="text-[11px] font-bold text-amber-900 bg-amber-300 px-2.5 py-1 rounded-full flex-shrink-0 shadow-sm">
              ✓ ODABRAN
            </span>
          )}
          {!selected && assigned && (
            <span className={`text-[10px] font-medium flex-shrink-0 ${isDark ? 'text-white/35' : 'text-gray-500'}`}>
              dodijeljen
            </span>
          )}
        </div>
      </div>
    </TouchFeedback>
  );
};

// ─────────────────────────────────────────────
// AssignmentCard — sa selektorom klase
// ─────────────────────────────────────────────
interface AssignmentCardProps {
  a: Assignment;
  type: 'desk' | 'gate';
  onRemove: () => void;
  onSetClass: (classType: string | null) => void;
  isDark: boolean;
}

const AssignmentCard: React.FC<AssignmentCardProps> = ({
  a, type, onRemove, onSetClass, isDark,
}) => {
  const borderColor =
    type === 'desk'
      ? isDark ? 'bg-sky-500/10 border-sky-500/30' : 'bg-sky-50 border-sky-300'
      : isDark ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-emerald-50 border-emerald-300';

  const labelColor =
    type === 'desk'
      ? isDark ? 'text-sky-400' : 'text-sky-800'
      : isDark ? 'text-emerald-400' : 'text-emerald-800';

  return (
    <div className={`rounded-xl border p-4 ${borderColor}`}>
      {/* Gornji red: info + brisanje */}
      <div className="flex items-start justify-between gap-2 mb-4">
        <div className="min-w-0">
          <div className={`text-xs font-bold tracking-wider mb-1 ${labelColor}`}>
            {type === 'desk' ? 'ŠALTER' : 'GATE'} {a.resourceId}
          </div>
          <div className={`font-mono font-bold text-base leading-tight ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {a.flightNumber}
          </div>
          <div className={`text-xs mt-0.5 truncate ${isDark ? 'text-white/50' : 'text-gray-500'}`}>
            {a.destinationCity} · {a.scheduledTime}
          </div>
          {/* Trenutna klasa badge */}
          {a.classType && (
            <span
              className={`inline-block mt-2 text-[10px] font-bold px-2.5 py-0.5 rounded-full ${classBadgeStyle(a.classType, isDark)}`}
            >
              {a.classType}
            </span>
          )}
        </div>
        <TouchFeedback onTap={onRemove}>
          <button className="p-2 rounded-lg text-gray-400 hover:text-red-500 transition-colors flex-shrink-0">
            <Trash2 size={16} />
          </button>
        </TouchFeedback>
      </div>

      {/* ── Selektor klase ── */}
      <div className={`text-[10px] font-bold tracking-wider uppercase mb-2 ${isDark ? 'text-white/30' : 'text-gray-400'}`}>
        Klasa putnika
      </div>
      <div className="grid grid-cols-4 gap-2">
        {PASSENGER_CLASSES.map(({ key, label, emoji }) => {
          const isActive = a.classType === key;
          return (
            <TouchFeedback key={key} onTap={() => onSetClass(isActive ? null : key)}>
              <button
                className={`w-full py-3 rounded-xl border-2 text-center transition-all ${
                  isActive
                    ? isDark
                      ? PASSENGER_CLASSES.find(c => c.key === key)!.dark
                      : PASSENGER_CLASSES.find(c => c.key === key)!.light
                    : isDark
                      ? 'bg-white/5 border-white/15 text-white/50'
                      : 'bg-white border-gray-200 text-gray-400'
                }`}
              >
                <div className="text-xl leading-none">{emoji}</div>
                <div className="text-[11px] font-semibold mt-1 leading-tight">{label}</div>
              </button>
            </TouchFeedback>
          );
        })}
      </div>

      {/* Obriši klasu — prikazuje se samo kad je klasa postavljena */}
      {a.classType && (
        <TouchFeedback onTap={() => onSetClass(null)}>
          <button
            className={`w-full mt-2 py-2 rounded-xl border text-xs font-medium transition-all ${
              isDark
                ? 'bg-white/5 border-white/10 text-white/40 hover:text-white/70'
                : 'bg-gray-100 border-gray-200 text-gray-400 hover:text-gray-600'
            }`}
          >
            ✕ Obriši klasu
          </button>
        </TouchFeedback>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────
// ConfirmOverlay
// ─────────────────────────────────────────────
const ConfirmOverlay: React.FC<{
  pending: PendingOverride;
  onConfirm: () => void;
  onCancel: () => void;
  isDark: boolean;
}> = ({ pending, onConfirm, onCancel, isDark }) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
    onClick={onCancel}
  >
    <div
      className={`rounded-2xl border p-6 max-w-sm w-full shadow-2xl ${
        isDark ? 'bg-slate-900 border-white/20' : 'bg-white border-gray-200'
      }`}
      onClick={e => e.stopPropagation()}
    >
      <div className={`font-bold text-lg mb-3 text-center ${isDark ? 'text-white' : 'text-gray-900'}`}>
        Zamijeniti dodjelu?
      </div>
      <div
        className={`text-sm mb-6 text-center leading-relaxed ${isDark ? 'text-white/70' : 'text-gray-600'}`}
      >
        {pending.resourceType === 'desk' ? 'Šalter' : 'Gate'} {pending.resourceId} je već dodijeljen
        letu{' '}
        <span className={`font-mono font-bold ${isDark ? 'text-red-400' : 'text-red-700'}`}>
          {pending.existingFlight}
        </span>
        .<br />
        Zamijeniti sa{' '}
        <span className={`font-mono font-bold ${isDark ? 'text-amber-400' : 'text-amber-700'}`}>
          {pending.flight.FlightNumber}
        </span>
        ?
      </div>
      <div className="flex gap-3">
        <button
          onClick={onCancel}
          className={`flex-1 py-3 rounded-xl text-sm font-medium border transition-colors ${
            isDark
              ? 'bg-white/10 border-white/20 text-white/80 active:bg-white/20'
              : 'bg-gray-100 border-gray-200 text-gray-600 active:bg-gray-200'
          }`}
        >
          Odustani
        </button>
        <button
          onClick={onConfirm}
          className="flex-1 py-3 rounded-xl text-sm font-bold bg-red-500 text-white active:bg-red-600 transition-colors shadow-lg"
        >
          Zamijeni
        </button>
      </div>
    </div>
  </div>
);

// ─────────────────────────────────────────────
// GLAVNA KOMPONENTA
// ─────────────────────────────────────────────
export default function AssignPanel() {
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<TabType>('checkin');
  const [flights, setFlights] = useState<Flight[]>([]);
  const [loadingFlights, setLoadingFlights] = useState(true);
  const [lastUpdate, setLastUpdate] = useState('');
  const [checkinAssignments, setCheckinAssignments] = useState<Assignment[]>([]);
  const [gateAssignments, setGateAssignments] = useState<Assignment[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedFlightForTouch, setSelectedFlightForTouch] = useState<Flight | null>(null);
  const [tickSec, setTickSec] = useState(REFRESH_INTERVAL_MS / 1000);
  const [pendingOverride, setPendingOverride] = useState<PendingOverride | null>(null);
  const [isDark, setIsDark] = useState(true);

  const flightsRef = useRef<Flight[]>([]);
  const selectedFlightRef = useRef<Flight | null>(null);
  const checkinAssignmentsRef = useRef<Assignment[]>([]);
  const gateAssignmentsRef = useRef<Assignment[]>([]);
  const touchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { flightsRef.current = flights; }, [flights]);
  useEffect(() => { checkinAssignmentsRef.current = checkinAssignments; }, [checkinAssignments]);
  useEffect(() => { gateAssignmentsRef.current = gateAssignments; }, [gateAssignments]);

  const setSelectedFlight = useCallback((flight: Flight | null) => {
    selectedFlightRef.current = flight;
    setSelectedFlightForTouch(flight);
  }, []);

  // ── Tema ──────────────────────────────────────────────────
  useEffect(() => {
    const stored = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const shouldBeDark = stored === 'dark' || (stored === null && prefersDark);
    setIsDark(shouldBeDark);
    document.documentElement.classList.toggle('dark', shouldBeDark);
  }, []);

  const toggleTheme = () => {
    const newDark = !isDark;
    setIsDark(newDark);
    document.documentElement.classList.toggle('dark', newDark);
    localStorage.setItem('theme', newDark ? 'dark' : 'light');
  };

  // ── API: Letovi ───────────────────────────────────────────
  const fetchFlightsData = useCallback(async (): Promise<Flight[]> => {
    const res = await fetch('/api/flights?nocache=' + Date.now());
    const data = await res.json();
    return processFlights(data.departures || []);
  }, []);

  const fetchFlights = useCallback(async () => {
    try {
      const sorted = await fetchFlightsData();
      setFlights(sorted);
      setLastUpdate(new Date().toLocaleTimeString('sr-Latn-RS'));
    } catch (err) {
      console.error('Error fetching flights:', err);
    } finally {
      setLoadingFlights(false);
    }
  }, [fetchFlightsData]);

  // ── API: Check-in dodjele (sa klasom) ────────────────────
  const fetchCheckinAssignments = useCallback(async (currentFlights: Flight[]) => {
    try {
      const res = await fetch(`${API_PREFIX}/desk-status-override`);
      if (!res.ok) return;
      const data = await res.json();

      // Dohvati klase za sve šaltere paralelno
      const deskNumbers = Object.entries(data)
        .filter(([, value]) => {
          const parsed = typeof value === 'string' ? JSON.parse(value) : value as Record<string, unknown>;
          return parsed.flightNumber && parsed.status === 'open';
        })
        .map(([deskNumber]) => deskNumber);

      const classResults = await Promise.allSettled(
        deskNumbers.map(async (deskNumber) => {
          const classRes = await fetch(`${API_PREFIX}/desk-class/${deskNumber}`);
          if (!classRes.ok) return { deskNumber, classType: null };
          const classData = await classRes.json();
          return { deskNumber, classType: classData.classType ?? null };
        })
      );

      const classMap: Record<string, string | null> = {};
      classResults.forEach(result => {
        if (result.status === 'fulfilled') {
          classMap[result.value.deskNumber] = result.value.classType;
        }
      });

      const list: Assignment[] = [];
      for (const [deskNumber, value] of Object.entries(data)) {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value as Record<string, unknown>;
        if (parsed.flightNumber && parsed.status === 'open') {
          const flight = currentFlights.find(f => f.FlightNumber === parsed.flightNumber);
          list.push({
            resourceId: deskNumber,
            flightNumber: parsed.flightNumber as string,
            airlineName: flight?.AirlineName || '',
            destinationCity: flight?.DestinationCityName || '',
            scheduledTime: flight?.ScheduledDepartureTime || '',
            assignedAt: parsed.setAt ? new Date(parsed.setAt as string).toLocaleTimeString() : 'unknown',
            classType: classMap[deskNumber] ?? null,
          });
        }
      }
      setCheckinAssignments(list);
    } catch (err) { console.error(err); }
  }, []);

  // ── API: Gate dodjele ─────────────────────────────────────
const fetchGateAssignments = useCallback(async (currentFlights: Flight[]) => {
  try {
    const res = await fetch(`${API_PREFIX}/gate-status-override`);
    if (!res.ok) return;
    const data = await res.json();

    const gateNumbers = Object.entries(data)
      .filter(([, value]) => {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value as Record<string, unknown>;
        return parsed.flightNumber && parsed.status === 'open';
      })
      .map(([gateNumber]) => gateNumber);

    // Dohvati klase za sve gate-ove paralelno
    const classResults = await Promise.allSettled(
      gateNumbers.map(async (gateNumber) => {
        const classRes = await fetch(`${API_PREFIX}/gate-class/${gateNumber}`);
        if (!classRes.ok) return { gateNumber, classType: null };
        const classData = await classRes.json();
        return { gateNumber, classType: classData.classType ?? null };
      })
    );

    const classMap: Record<string, string | null> = {};
    classResults.forEach(result => {
      if (result.status === 'fulfilled') {
        classMap[result.value.gateNumber] = result.value.classType;
      }
    });

    const list: Assignment[] = [];
    for (const [gateNumber, value] of Object.entries(data)) {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value as Record<string, unknown>;
      if (parsed.flightNumber && parsed.status === 'open') {
        const flight = currentFlights.find(f => f.FlightNumber === parsed.flightNumber);
        list.push({
          resourceId: gateNumber,
          flightNumber: parsed.flightNumber as string,
          airlineName: flight?.AirlineName || '',
          destinationCity: flight?.DestinationCityName || '',
          scheduledTime: flight?.ScheduledDepartureTime || '',
          assignedAt: parsed.setAt ? new Date(parsed.setAt as string).toLocaleTimeString() : 'unknown',
          classType: classMap[gateNumber] ?? null,
        });
      }
    }
    setGateAssignments(list);
  } catch (err) { console.error(err); }
}, []);

  const refreshAll = useCallback(async (currentFlights: Flight[]) => {
    await Promise.all([
      fetchCheckinAssignments(currentFlights),
      fetchGateAssignments(currentFlights),
    ]);
  }, [fetchCheckinAssignments, fetchGateAssignments]);

  useEffect(() => {
    fetchFlights().then(() => refreshAll(flightsRef.current));
  }, [fetchFlights, refreshAll]);

  // ── Auto-refresh ──────────────────────────────────────────
  useEffect(() => {
    const ticker = setInterval(
      () => setTickSec(prev => (prev <= 1 ? REFRESH_INTERVAL_MS / 1000 : prev - 1)),
      1000
    );
    const interval = setInterval(async () => {
      setTickSec(REFRESH_INTERVAL_MS / 1000);
      try {
        const sorted = await fetchFlightsData();
        setFlights(sorted);
        setLastUpdate(new Date().toLocaleTimeString('sr-Latn-RS'));
        await refreshAll(sorted);
      } catch (err) { console.error('Silent refresh error:', err); }
    }, REFRESH_INTERVAL_MS);
    return () => { clearInterval(ticker); clearInterval(interval); };
  }, [fetchFlightsData, refreshAll]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setTickSec(REFRESH_INTERVAL_MS / 1000);
    try {
      const sorted = await fetchFlightsData();
      setFlights(sorted);
      setLastUpdate(new Date().toLocaleTimeString('sr-Latn-RS'));
      await refreshAll(sorted);
    } catch (err) { console.error(err); }
    finally { setRefreshing(false); }
  }, [fetchFlightsData, refreshAll]);

  // ── Dodjela šaltera/gate ──────────────────────────────────
  const assignFlightToResource = useCallback(async (
    flight: Flight,
    resourceId: string,
    resourceType: 'desk' | 'gate',
  ): Promise<boolean> => {
    const endpoint = `${API_PREFIX}/${resourceType === 'desk' ? 'desk-status-override' : 'gate-status-override'}`;
    const payload =
      resourceType === 'desk'
        ? { deskNumber: resourceId, action: 'open', flightNumber: flight.FlightNumber }
        : { gateNumber: resourceId, action: 'open', flightNumber: flight.FlightNumber };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      await refreshAll(flightsRef.current);
      return true;
    } catch (err) {
      console.error('Greška pri dodjeli:', err);
      return false;
    }
  }, [refreshAll]);

  const handleResourceTouchAssign = useCallback(async (
    resourceId: string,
    resourceType: 'desk' | 'gate',
  ) => {
    const flight = selectedFlightRef.current;
    if (!flight) return;

    const assignments =
      resourceType === 'desk' ? checkinAssignmentsRef.current : gateAssignmentsRef.current;
    const existing = assignments.find(a => a.resourceId === resourceId);

    if (existing) {
      setPendingOverride({ flight, resourceId, resourceType, existingFlight: existing.flightNumber });
      return;
    }

    await assignFlightToResource(flight, resourceId, resourceType);
    setSelectedFlight(null);
    if (touchTimeoutRef.current) clearTimeout(touchTimeoutRef.current);
  }, [assignFlightToResource, setSelectedFlight]);

  const handleConfirmOverride = useCallback(async () => {
    const p = pendingOverride;
    setPendingOverride(null);
    if (!p) return;
    await assignFlightToResource(p.flight, p.resourceId, p.resourceType);
    setSelectedFlight(null);
    if (touchTimeoutRef.current) clearTimeout(touchTimeoutRef.current);
  }, [pendingOverride, assignFlightToResource, setSelectedFlight]);

  const handleFlightTouchSelect = useCallback((flight: Flight) => {
    setSelectedFlight(flight);
    if (touchTimeoutRef.current) clearTimeout(touchTimeoutRef.current);
    touchTimeoutRef.current = setTimeout(() => setSelectedFlight(null), TOUCH_TIMEOUT_MS);
  }, [setSelectedFlight]);

  // ── Brisanje dodjela ──────────────────────────────────────
  const handleRemoveCheckin = useCallback(async (deskNumber: string) => {
    try {
      await fetch(`${API_PREFIX}/desk-status-override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deskNumber, action: 'clear' }),
      });
      // Očisti i klasu kad se obriše šalter
      await fetch(`${API_PREFIX}/desk-class/${deskNumber}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classType: null }),
      });
      await fetchCheckinAssignments(flightsRef.current);
    } catch { console.error('Greška pri brisanju šaltera', deskNumber); }
  }, [fetchCheckinAssignments]);

const handleRemoveGate = useCallback(async (gateNumber: string) => {
  try {
    await fetch(`${API_PREFIX}/gate-status-override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gateNumber, action: 'clear' }),
    });
    // Očisti klasu zajedno sa gate dodjelom
    await fetch(`${API_PREFIX}/gate-class/${gateNumber}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classType: null }),
    });
    await fetchGateAssignments(flightsRef.current);
  } catch { console.error('Greška pri brisanju gate-a', gateNumber); }
}, [fetchGateAssignments]);

  // ── Postavljanje klase ────────────────────────────────────
  const handleSetClass = useCallback(async (deskNumber: string, classType: string | null) => {
    // Optimistički update — odmah se vidi promjena bez čekanja API-ja
    setCheckinAssignments(prev =>
      prev.map(a => a.resourceId === deskNumber ? { ...a, classType } : a)
    );

    try {
      await fetch(`${API_PREFIX}/desk-class/${deskNumber}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classType }),
      });
    } catch {
      console.error('Greška pri postavljanju klase za šalter', deskNumber);
      // Rollback — ponovo učitaj iz servera ako API padne
      await fetchCheckinAssignments(flightsRef.current);
    }
  }, [fetchCheckinAssignments]);
  const handleSetGateClass = useCallback(async (gateNumber: string, classType: string | null) => {
  setGateAssignments(prev =>
    prev.map(a => a.resourceId === gateNumber ? { ...a, classType } : a)
  );
  try {
    await fetch(`${API_PREFIX}/gate-class/${gateNumber}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classType }),
    });
  } catch {
    console.error('Greška pri postavljanju klase za gate', gateNumber);
    await fetchGateAssignments(flightsRef.current);
  }
}, [fetchGateAssignments]);

  // ── Helpers ───────────────────────────────────────────────
  const isFlightAssigned = (flightNumber: string, tab: TabType) =>
    tab === 'checkin'
      ? checkinAssignments.some(a => a.flightNumber === flightNumber)
      : gateAssignments.some(a => a.flightNumber === flightNumber);

  // ── Loading ───────────────────────────────────────────────
  if (loadingFlights) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${isDark ? 'bg-slate-950' : 'bg-white'}`}>
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-3 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <div className={`text-sm tracking-widest uppercase ${isDark ? 'text-white/50' : 'text-gray-500'}`}>
            Učitavanje
          </div>
        </div>
      </div>
    );
  }

  // ── Render helpers ────────────────────────────────────────
  const flightList = (tab: TabType) => (
    <div className="space-y-2 max-h-[65vh] overflow-y-auto pr-1 scrollbar-thin">
      {flights.length === 0 && (
        <div className={`text-center py-12 text-sm ${isDark ? 'text-white/30' : 'text-gray-400'}`}>
          <Plane size={36} className="mx-auto mb-3 opacity-30" />
          Nema aktivnih letova
        </div>
      )}
      {flights.map(flight => (
        <FlightRow
          key={flight.FlightNumber + flight.ScheduledDepartureTime}
          flight={flight}
          assigned={isFlightAssigned(flight.FlightNumber, tab)}
          selected={selectedFlightForTouch?.FlightNumber === flight.FlightNumber}
          onSelect={() => handleFlightTouchSelect(flight)}
          isDark={isDark}
        />
      ))}
    </div>
  );

  const resourceGrid = (type: 'desk' | 'gate', items: string[], occupied: Assignment[]) => (
    <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
      {items.map(id => (
        <ResourceCell
          key={id}
          id={id}
          type={type}
          occupied={occupied.find(a => a.resourceId === id)}
          flightReady={!!selectedFlightForTouch && !occupied.find(a => a.resourceId === id)}
          onAssign={() => handleResourceTouchAssign(id, type)}
          isDark={isDark}
        />
      ))}
    </div>
  );

  // ── JSX ───────────────────────────────────────────────────
  return (
    <div
      className={`min-h-screen p-4 overflow-y-auto ${
        isDark ? 'bg-slate-950 text-white' : 'bg-white text-gray-900'
      }`}
    >
      {pendingOverride && (
        <ConfirmOverlay
          pending={pendingOverride}
          onConfirm={handleConfirmOverride}
          onCancel={() => setPendingOverride(null)}
          isDark={isDark}
        />
      )}

      <div className="max-w-7xl mx-auto">
        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Fingerprint size={24} className="text-sky-500" />
              <h1 className="text-xl font-bold tracking-tight">TIV · Check-in &amp; Gate</h1>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className={isDark ? 'text-white/30' : 'text-gray-500'}>
                ✈️ Letovi: {flights.length}
              </span>
              <span className={isDark ? 'text-white/15' : 'text-gray-300'}>|</span>
              <span className={isDark ? 'text-white/30' : 'text-gray-500'}>
                🕐 Ažurirano: {lastUpdate || '—'}
              </span>
              <span className={isDark ? 'text-white/15' : 'text-gray-300'}>|</span>
              <span className={`tabular-nums ${isDark ? 'text-white/25' : 'text-gray-500'}`}>
                🔄 Refresh za {tickSec}s
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className={`p-2.5 rounded-xl border transition-all active:scale-95 ${
                isDark
                  ? 'bg-white/5 hover:bg-white/10 border-white/10'
                  : 'bg-gray-100 hover:bg-gray-200 border-gray-300'
              }`}
            >
              <RefreshCw
                size={16}
                className={`${isDark ? 'text-white/60' : 'text-gray-600'} ${refreshing ? 'animate-spin' : ''}`}
              />
            </button>
            <button
              onClick={() => router.push('/admin')}
              className={`p-2.5 rounded-xl border transition-all active:scale-95 ${
                isDark
                  ? 'bg-white/5 hover:bg-white/10 border-white/10'
                  : 'bg-gray-100 hover:bg-gray-200 border-gray-300'
              }`}
            >
              <Home size={16} className={isDark ? 'text-white/60' : 'text-gray-600'} />
            </button>
            <button
              onClick={toggleTheme}
              className={`p-2.5 rounded-xl border transition-all active:scale-95 ${
                isDark
                  ? 'bg-white/5 hover:bg-white/10 border-white/10'
                  : 'bg-gray-100 hover:bg-gray-200 border-gray-300'
              }`}
            >
              {isDark
                ? <Sun size={16} className="text-yellow-400" />
                : <Moon size={16} className="text-slate-700" />}
            </button>
            <button
              onClick={async () => {
                await fetch('/api/admin/logout', { method: 'POST' }).catch(() => {});
                router.push('/admin/login');
              }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/25 text-red-400 text-xs font-medium transition-all active:scale-95"
            >
              <LogOut size={14} /> Odjava
            </button>
          </div>
        </div>

        {/* ── Tabovi ── */}
        <div className="flex gap-3 mb-6">
          {[
            { id: 'checkin' as TabType, label: '🏷️ Check-in', icon: CheckSquare, count: checkinAssignments.length },
            { id: 'gate' as TabType, label: '🚪 Gate-ovi', icon: GitBranch, count: gateAssignments.length },
          ].map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-5 py-3 rounded-xl border text-sm font-semibold transition-all active:scale-95 ${
                  isActive
                    ? isDark
                      ? 'bg-sky-500/20 border-sky-500/50 text-sky-300 shadow-lg'
                      : 'bg-sky-200 border-sky-500 text-sky-900 shadow-md'
                    : isDark
                      ? 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10'
                      : 'bg-gray-100 border-gray-300 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <tab.icon size={16} />
                <span>{tab.label}</span>
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${
                    isActive
                      ? isDark ? 'bg-white/20 text-white' : 'bg-white/80 text-gray-800'
                      : isDark ? 'bg-white/10 text-white/40' : 'bg-gray-300 text-gray-600'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── Selected Flight Banner ── */}
        {selectedFlightForTouch && (
          <div className="mb-5 p-4 rounded-xl bg-amber-500/15 border-2 border-amber-400/50 shadow-lg shadow-amber-500/20">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-amber-400 animate-pulse" />
                <span className={`font-mono font-bold text-lg ${isDark ? 'text-amber-200' : 'text-amber-900'}`}>
                  {selectedFlightForTouch.FlightNumber}
                </span>
                <span className={`text-base ${isDark ? 'text-amber-400/80' : 'text-amber-800'}`}>
                  → {selectedFlightForTouch.DestinationCityName || selectedFlightForTouch.DestinationAirportCode}
                </span>
              </div>
              <button
                onClick={() => setSelectedFlight(null)}
                className="flex items-center gap-1.5 text-sm text-amber-400/70 hover:text-amber-300 px-3 py-1.5 rounded-lg hover:bg-amber-500/10 transition-colors"
              >
                <X size={14} /> Odustani
              </button>
            </div>
          </div>
        )}

        {/* ── CHECK-IN TAB ── */}
        {activeTab === 'checkin' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Lista letova */}
            <div className={`rounded-xl border p-4 ${isDark ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
              <div className={`text-xs font-bold tracking-wider uppercase mb-4 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
                ✈️ Letovi ({flights.length})
              </div>
              {flightList('checkin')}
            </div>

            <div className="lg:col-span-2 space-y-5">
              {/* Grid šaltera */}
              <div className={`rounded-xl border p-4 ${isDark ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                <div className={`text-xs font-bold tracking-wider uppercase mb-4 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
                  📋 Šalteri
                </div>
                <div className="mb-5">
                  <div className="text-center text-sm font-medium mb-3 text-sky-400">
                    Terminal 1
                  </div>
                  {resourceGrid('desk', DESKS.filter(d => parseInt(d) <= 12), checkinAssignments)}
                </div>
                <div>
                  <div className="text-center text-sm font-medium mb-3 text-emerald-400">
                    Terminal 2
                  </div>
                  {resourceGrid('desk', DESKS.filter(d => parseInt(d) >= 21), checkinAssignments)}
                </div>
              </div>

              {/* Aktivne dodjele sa selektorom klase */}
              <div className={`rounded-xl border p-4 ${isDark ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                <div className={`text-xs font-bold tracking-wider uppercase mb-3 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
                  ✅ Aktivne dodjele ({checkinAssignments.length})
                </div>

                {checkinAssignments.length === 0 ? (
                  <div className={`text-center py-8 text-sm ${isDark ? 'text-white/30' : 'text-gray-400'}`}>
                    Nema dodjela
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {checkinAssignments.map(a => (
                      <AssignmentCard
                        key={a.resourceId}
                        a={a}
                        type="desk"
                        onRemove={() => handleRemoveCheckin(a.resourceId)}
                        onSetClass={(classType) => handleSetClass(a.resourceId, classType)}
                        isDark={isDark}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── GATE TAB ── */}
        {activeTab === 'gate' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className={`rounded-xl border p-4 ${isDark ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
              <div className={`text-xs font-bold tracking-wider uppercase mb-4 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
                ✈️ Letovi ({flights.length})
              </div>
              {flightList('gate')}
            </div>
            <div className="lg:col-span-2 space-y-5">
              <div className={`rounded-xl border p-4 ${isDark ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                <div className={`text-xs font-bold tracking-wider uppercase mb-4 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
                  🚪 Gate-ovi
                </div>
                <div className="mb-5">
                  <div className="text-center text-sm font-medium mb-3 text-sky-400">Terminal 1</div>
                  {resourceGrid('gate', GATES.filter(g => parseInt(g) >= 2 && parseInt(g) <= 6), gateAssignments)}
                </div>
                <div>
                  <div className="text-center text-sm font-medium mb-3 text-emerald-400">Terminal 2</div>
                  {resourceGrid('gate', GATES.filter(g => parseInt(g) >= 21 && parseInt(g) <= 28), gateAssignments)}
                </div>
              </div>
              <div className={`rounded-xl border p-4 ${isDark ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                <div className={`text-xs font-bold tracking-wider uppercase mb-3 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
                  ✅ Aktivne dodjele ({gateAssignments.length})
                </div>
                {gateAssignments.length === 0 ? (
                  <div className={`text-center py-8 text-sm ${isDark ? 'text-white/30' : 'text-gray-400'}`}>
                    Nema dodjela
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
     {gateAssignments.map(a => (
  <AssignmentCard
    key={a.resourceId}
    a={a}
    type="gate"
    onRemove={() => handleRemoveGate(a.resourceId)}
    onSetClass={(classType) => handleSetGateClass(a.resourceId, classType)}  // ← ovo je izmjena
    isDark={isDark}
  />
))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <style jsx global>{`
        html, body, #__next { overflow: auto !important; height: auto !important; min-height: 100vh; }
        * { -webkit-tap-highlight-color: transparent; }
        .touch-manipulation { touch-action: manipulation; }
        .scrollbar-thin::-webkit-scrollbar { width: 4px; }
        .scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
        .scrollbar-thin::-webkit-scrollbar-thumb {
          background: ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.2)'};
          border-radius: 4px;
        }
        @keyframes pulse-subtle { 0%, 100% { opacity: 0.8; } 50% { opacity: 1; } }
        .animate-pulse-subtle { animation: pulse-subtle 1.2s ease-in-out infinite; }
        .active\\:scale-95:active { transform: scale(0.95); }
      `}</style>
    </div>
  );
}