'use client';

import { useState, useEffect } from 'react';
import { 
  getAllAirlines, 
  getAirlineByIata, 
  createAirline, 
  updateAirline,
  deleteAirline,
  getAllSpecificFlights,
  createSpecificFlight,
  updateSpecificFlight,
  deleteSpecificFlight,
  getAllDestinations,
  getDestinationsByAirline,
  createDestination,
  updateDestination,
  deleteDestination,
  getCurrentSeason,
  initializeDefaultData
} from '@/lib/business-class-service';
import { 
  Plus, 
  Edit, 
  Trash2, 
  Save, 
  X, 
  Plane, 
  MapPin, 
  Building, 
  Calendar,
  Clock,
  Check,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

// Tipovi
interface Airline {
  id: number;
  iataCode: string;
  airlineName: string;
  hasBusinessClass: boolean;
  winterSchedule: {
    hasBusinessClass: boolean;
    specificFlights: string[];
    daysOfWeek: number[];
    startDate: string | null;
    endDate: string | null;
  };
  summerSchedule: {
    hasBusinessClass: boolean;
    specificFlights: string[];
    daysOfWeek: number[];
    startDate: string | null;
    endDate: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

interface SpecificFlight {
  id: number;
  flightNumber: string;
  airlineIata: string;
  alwaysBusinessClass: boolean;
  winterOnly: boolean;
  summerOnly: boolean;
  daysOfWeek: number[];
  validFrom: string | null;
  validUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Destination {
  id: number;
  destinationCode: string;
  destinationName: string;
  airlineIata: string;
  hasBusinessClass: boolean;
  winterSchedule: {
    hasBusinessClass: boolean;
    startDate: string | null;
    endDate: string | null;
  };
  summerSchedule: {
    hasBusinessClass: boolean;
    startDate: string | null;
    endDate: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

const DAYS_OF_WEEK = [
  { id: 0, name: 'Nedelja', short: 'N' },
  { id: 1, name: 'Ponedeljak', short: 'P' },
  { id: 2, name: 'Utorak', short: 'U' },
  { id: 3, name: 'Srijeda', short: 'S' },
  { id: 4, name: 'Četvrtak', short: 'Č' },
  { id: 5, name: 'Petak', short: 'P' },
  { id: 6, name: 'Subota', short: 'S' },
];

export default function BusinessClassAdminPage() {
  const [activeTab, setActiveTab] = useState<'airlines' | 'flights' | 'destinations'>('airlines');
  const [airlines, setAirlines] = useState<Airline[]>([]);
  const [specificFlights, setSpecificFlights] = useState<SpecificFlight[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<any>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // Učitaj podatke
  useEffect(() => {
    loadData();
  }, [activeTab]);
  
const loadData = async () => {
  setLoading(true);
  setError(null);
  try {
    if (activeTab === 'airlines') {
      const data = await getAllAirlines();
      setAirlines(data);
    } else if (activeTab === 'flights') {
      const data = await getAllSpecificFlights();
      
      // Uklonite duplikate na osnovu flightNumber i airlineIata
      const uniqueFlights = data.reduce((acc: SpecificFlight[], current) => {
        const exists = acc.find(
          flight => 
            flight.flightNumber === current.flightNumber && 
            flight.airlineIata === current.airlineIata
        );
        if (!exists) {
          acc.push(current);
        } else {
          console.warn(`Duplikat leta pronađen: ${current.flightNumber}-${current.airlineIata}`);
        }
        return acc;
      }, []);
      
      console.log(`Učitano ${data.length} letova, ${uniqueFlights.length} jedinstvenih`);
      setSpecificFlights(uniqueFlights);
    } else if (activeTab === 'destinations') {
      const data = await getAllDestinations();
      setDestinations(data);
    }
  } catch (error) {
    console.error('Error loading data:', error);
    setError('Greška pri učitavanju podataka');
  } finally {
    setLoading(false);
  }
};
  
  const handleNew = () => {
    if (activeTab === 'airlines') {
      setFormData({
        iataCode: '',
        airlineName: '',
        hasBusinessClass: false,
        winterSchedule: {
          hasBusinessClass: false,
          specificFlights: [],
          daysOfWeek: [],
          startDate: null,
          endDate: null
        },
        summerSchedule: {
          hasBusinessClass: false,
          specificFlights: [],
          daysOfWeek: [],
          startDate: null,
          endDate: null
        }
      });
    } else if (activeTab === 'flights') {
      setFormData({
        flightNumber: '',
        airlineIata: '',
        alwaysBusinessClass: false,
        winterOnly: false,
        summerOnly: false,
        daysOfWeek: [],
        validFrom: null,
        validUntil: null
      });
    } else if (activeTab === 'destinations') {
      setFormData({
        destinationCode: '',
        destinationName: '',
        airlineIata: '',
        hasBusinessClass: false,
        winterSchedule: {
          hasBusinessClass: false,
          startDate: null,
          endDate: null
        },
        summerSchedule: {
          hasBusinessClass: false,
          startDate: null,
          endDate: null
        }
      });
    }
    setEditingId('new');
    setIsModalOpen(true);
  };
  
const handleEdit = (item: any) => {
  console.log('=== HANDLE EDIT ===');
  console.log('Active tab:', activeTab);
  console.log('Item:', item);
  
  // Postavi editingId na osnovu activeTab
  if (activeTab === 'airlines') {
    setEditingId(item.iataCode);
  } else if (activeTab === 'flights') {
    // Za letove, koristi flightNumber
    setEditingId(item.flightNumber);
  } else if (activeTab === 'destinations') {
    setEditingId(`${item.destinationCode}-${item.airlineIata}`);
  }
  
  // Očisti i popuni formData sa eksplicitnim konverzijama
  let cleanedItem = { ...item };
  
  // Osiguraj da su sva polja prisutna i konvertovana
  if (activeTab === 'flights') {
    cleanedItem = {
      ...cleanedItem,
      alwaysBusinessClass: Boolean(item.alwaysBusinessClass),
      winterOnly: Boolean(item.winterOnly),
      summerOnly: Boolean(item.summerOnly),
      daysOfWeek: Array.isArray(item.daysOfWeek) ? item.daysOfWeek : [],
      validFrom: item.validFrom || null,
      validUntil: item.validUntil || null
    };
  }
  
  console.log('Cleaned item for form:', cleanedItem);
  setFormData(cleanedItem);
  setIsModalOpen(true);
};
  const handleCancel = () => {
    setEditingId(null);
    setFormData({});
    setError(null);
    setSuccess(null);
    setIsModalOpen(false);
  };
  
const handleSave = async () => {
  setError(null);
  setSuccess(null);
  
  console.log('=== HANDLE SAVE ===');
  console.log('Active tab:', activeTab);
  console.log('Editing ID:', editingId);
  console.log('Form data:', formData);
  
  try {
    if (activeTab === 'airlines') {
      if (editingId === 'new') {
        console.log('Creating new airline...');
        await createAirline(formData);
        setSuccess('Avio kompanija uspješno dodata');
      } else {
        console.log('Updating airline:', editingId);
        await updateAirline(editingId!, formData);
        setSuccess('Avio kompanija uspješno ažurirana');
      }
    } else if (activeTab === 'flights') {
      // Dodajte dodatnu validaciju za letove
      const flightData = {
        ...formData,
        // Osiguraj da su daysOfWeek array i da su boolean vrednosti konvertovane
        daysOfWeek: Array.isArray(formData.daysOfWeek) ? formData.daysOfWeek : [],
        alwaysBusinessClass: Boolean(formData.alwaysBusinessClass),
        winterOnly: Boolean(formData.winterOnly),
        summerOnly: Boolean(formData.summerOnly),
        validFrom: formData.validFrom || null,
        validUntil: formData.validUntil || null
      };
      
      console.log('Sending flight data:', flightData);
      
      if (editingId === 'new') {
        await createSpecificFlight(flightData);
        setSuccess('Let uspješno dodat');
      } else {
        // Koristite flightNumber iz formData ako je editingId samo broj leta
        const flightNumberToUpdate = formData.flightNumber || editingId;
        console.log('Updating flight:', flightNumberToUpdate);
        await updateSpecificFlight(flightNumberToUpdate, flightData);
        setSuccess('Let uspješno ažuriran');
      }
    } else if (activeTab === 'destinations') {
      if (editingId === 'new') {
        await createDestination(formData);
        setSuccess('Destinacija uspješno dodata');
      } else {
        const [destinationCode, airlineIata] = editingId!.split('-');
        await updateDestination(destinationCode, airlineIata, formData);
        setSuccess('Destinacija uspješno ažurirana');
      }
    }
    
    handleCancel();
    await loadData();
    
    // Sakrij poruku nakon 3 sekunde
    setTimeout(() => setSuccess(null), 3000);
  } catch (error: any) {
    console.error('=== HANDLE SAVE ERROR ===');
    console.error('Error:', error);
    console.error('Error message:', error.message);
    setError(error.message || 'Greška pri čuvanju podataka');
  }
};
  
  const handleDelete = async (item: any) => {
    if (!confirm('Da li ste sigurni da želite da obrišete ovaj zapis?')) return;
    
    try {
      if (activeTab === 'airlines') {
        await deleteAirline(item.iataCode);
        setSuccess('Avio kompanija uspješno obrisana');
      } else if (activeTab === 'flights') {
        await deleteSpecificFlight(item.flightNumber);
        setSuccess('Let uspješno obrisan');
      } else if (activeTab === 'destinations') {
        await deleteDestination(item.destinationCode, item.airlineIata);
        setSuccess('Destinacija uspješno obrisana');
      }
      
      await loadData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (error: any) {
      console.error('Error deleting item:', error);
      setError(error.message || 'Greška pri brisanju podataka');
    }
  };
  
  const handleInitializeData = async () => {
    if (confirm('Ovo će dodati podrazumevane podatke za Air Serbia i Turkish Airlines. Nastaviti?')) {
      try {
        await initializeDefaultData();
        setSuccess('Podrazumevani podaci uspješno inicijalizovani');
        await loadData();
        setTimeout(() => setSuccess(null), 3000);
      } catch (error) {
        console.error('Error initializing data:', error);
        setError('Greška pri inicijalizaciji podataka');
      }
    }
  };
  
  const toggleDay = (dayId: number) => {
    const currentDays = formData.daysOfWeek || [];
    const newDays = currentDays.includes(dayId)
      ? currentDays.filter((d: number) => d !== dayId)
      : [...currentDays, dayId];
    
    setFormData({ ...formData, daysOfWeek: newDays });
  };
  
  const addSpecificFlightInput = (season: 'winter' | 'summer') => {
    const currentFlights = formData[`${season}Schedule`]?.specificFlights || [];
    const newSchedule = {
      ...formData[`${season}Schedule`],
      specificFlights: [...currentFlights, '']
    };
    
    setFormData({
      ...formData,
      [`${season}Schedule`]: newSchedule
    });
  };
  
  const updateSpecificFlightValue = (season: 'winter' | 'summer', index: number, value: string) => {
    const currentFlights = formData[`${season}Schedule`]?.specificFlights || [];
    const newFlights = [...currentFlights];
    newFlights[index] = value;
    
    setFormData({
      ...formData,
      [`${season}Schedule`]: {
        ...formData[`${season}Schedule`],
        specificFlights: newFlights
      }
    });
  };
  
  const removeSpecificFlightInput = (season: 'winter' | 'summer', index: number) => {
    const currentFlights = formData[`${season}Schedule`]?.specificFlights || [];
    const newFlights = currentFlights.filter((_: string, i: number) => i !== index);
    
    setFormData({
      ...formData,
      [`${season}Schedule`]: {
        ...formData[`${season}Schedule`],
        specificFlights: newFlights
      }
    });
  };
  
  const toggleScheduleDay = (season: 'winter' | 'summer', dayId: number) => {
    const currentDays = formData[`${season}Schedule`]?.daysOfWeek || [];
    const newDays = currentDays.includes(dayId)
      ? currentDays.filter((d: number) => d !== dayId)
      : [...currentDays, dayId];
    
    setFormData({
      ...formData,
      [`${season}Schedule`]: {
        ...formData[`${season}Schedule`],
        daysOfWeek: newDays
      }
    });
  };
  
  // Helper funkcija za formatiranje datuma za input
  const formatDateForInput = (date: string | null): string => {
    if (!date) return '';
    try {
      return new Date(date).toISOString().split('T')[0];
    } catch {
      return '';
    }
  };
  
  const renderAirlinesTab = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-white">Konfiguracija avio kompanija</h2>
        <div className="flex gap-2">
          <button
            onClick={handleInitializeData}
            className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg transition-colors"
          >
            <Clock size={20} />
            Inicijalizuj podrazumevane
          </button>
          <button
            onClick={handleNew}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
          >
            <Plus size={20} />
            Dodaj avio kompaniju
          </button>
        </div>
      </div>
      
      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}
      
      {success && (
        <div className="bg-green-900/30 border border-green-700 text-green-300 px-4 py-3 rounded-lg">
          {success}
        </div>
      )}
      
      {loading ? (
        <div className="text-center py-8 text-white/70">Učitavanje...</div>
      ) : airlines.length === 0 ? (
        <div className="text-center py-12">
          <Building className="mx-auto h-12 w-12 text-slate-500 mb-4" />
          <h3 className="text-lg font-medium text-white mb-2">Nema avio kompanija</h3>
          <p className="text-slate-400 mb-4">Dodajte prvu avio kompaniju ili inicijalizujte podrazumevane podatke.</p>
          <button
            onClick={handleInitializeData}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
          >
            <Clock size={20} />
            Inicijalizuj podrazumevane
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {airlines.map((airline) => (
            <div key={airline.iataCode} className="bg-slate-800/50 rounded-xl shadow p-4 border border-slate-700/50">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="font-bold text-lg text-white">{airline.iataCode}</h3>
                  <p className="text-slate-300">{airline.airlineName}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEdit(airline)}
                    className="p-1 text-blue-400 hover:bg-blue-900/30 rounded transition-colors"
                    title="Izmeni"
                  >
                    <Edit size={18} />
                  </button>
                  <button
                    onClick={() => handleDelete(airline)}
                    className="p-1 text-red-400 hover:bg-red-900/30 rounded transition-colors"
                    title="Obriši"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
              
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-300">Business Class:</span>
                  <span className={`px-2 py-1 rounded text-xs ${airline.hasBusinessClass ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300'}`}>
                    {airline.hasBusinessClass ? 'DA' : 'NE'}
                  </span>
                </div>
                
                <div className="text-sm">
                  <div className="font-medium text-slate-300">Zimska sezona:</div>
                  <div className="flex items-center gap-1">
                    <span className={airline.winterSchedule?.hasBusinessClass ? 'text-green-400' : 'text-red-400'}>
                      {airline.winterSchedule?.hasBusinessClass ? 'DA' : 'NE'}
                    </span>
                    {airline.winterSchedule?.specificFlights?.length > 0 && (
                      <span className="text-xs text-slate-500">
                        ({airline.winterSchedule.specificFlights.length} specijalnih letova)
                      </span>
                    )}
                  </div>
                </div>
                
                <div className="text-sm">
                  <div className="font-medium text-slate-300">Letnja sezona:</div>
                  <div className="flex items-center gap-1">
                    <span className={airline.summerSchedule?.hasBusinessClass ? 'text-green-400' : 'text-red-400'}>
                      {airline.summerSchedule?.hasBusinessClass ? 'DA' : 'NE'}
                    </span>
                    {airline.summerSchedule?.specificFlights?.length > 0 && (
                      <span className="text-xs text-slate-500">
                        ({airline.summerSchedule.specificFlights.length} specijalnih letova)
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
  
  const renderFlightsTab = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-white">Specijalni letovi</h2>
        <button
          onClick={handleNew}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
        >
          <Plus size={20} />
          Dodaj let
        </button>
      </div>
      
      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}
      
      {success && (
        <div className="bg-green-900/30 border border-green-700 text-green-300 px-4 py-3 rounded-lg">
          {success}
        </div>
      )}
      
      {loading ? (
        <div className="text-center py-8 text-white/70">Učitavanje...</div>
      ) : specificFlights.length === 0 ? (
        <div className="text-center py-12">
          <Plane className="mx-auto h-12 w-12 text-slate-500 mb-4" />
          <h3 className="text-lg font-medium text-white mb-2">Nema specijalnih letova</h3>
          <p className="text-slate-400">Dodajte prvi specijalni let.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full bg-slate-800/50 rounded-lg shadow border border-slate-700/50">
            <thead>
              <tr className="bg-slate-800/70">
                <th className="px-4 py-3 text-left text-slate-300">Broj leta</th>
                <th className="px-4 py-3 text-left text-slate-300">Avio kompanija</th>
                <th className="px-4 py-3 text-left text-slate-300">Business</th>
                <th className="px-4 py-3 text-left text-slate-300">Sezona</th>
                <th className="px-4 py-3 text-left text-slate-300">Dani</th>
                <th className="px-4 py-3 text-left text-slate-300">Akcije</th>
              </tr>
            </thead>
            <tbody>
              {specificFlights.map((flight) => (
                <tr key={flight.flightNumber} className="border-t border-slate-700/50 hover:bg-slate-800/30">
                  <td className="px-4 py-3 font-medium text-white">{flight.flightNumber}</td>
                  <td className="px-4 py-3 text-slate-300">{flight.airlineIata}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded text-xs ${flight.alwaysBusinessClass ? 'bg-green-900/30 text-green-300' : 'bg-slate-700 text-slate-400'}`}>
                      {flight.alwaysBusinessClass ? 'DA' : 'NE'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {flight.winterOnly && 'ZIMA'}
                    {flight.summerOnly && 'LETO'}
                    {!flight.winterOnly && !flight.summerOnly && 'SVE'}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {flight.daysOfWeek?.length > 0 
                      ? flight.daysOfWeek.map((day: number) => 
                          DAYS_OF_WEEK.find(d => d.id === day)?.short
                        ).join(', ')
                      : 'Svi dani'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEdit(flight)}
                        className="p-1 text-blue-400 hover:bg-blue-900/30 rounded transition-colors"
                        title="Izmeni"
                      >
                        <Edit size={18} />
                      </button>
                      <button
                        onClick={() => handleDelete(flight)}
                        className="p-1 text-red-400 hover:bg-red-900/30 rounded transition-colors"
                        title="Obriši"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
  
  const renderDestinationsTab = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-white">Destinacije</h2>
        <button
          onClick={handleNew}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
        >
          <Plus size={20} />
          Dodaj destinaciju
        </button>
      </div>
      
      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}
      
      {success && (
        <div className="bg-green-900/30 border border-green-700 text-green-300 px-4 py-3 rounded-lg">
          {success}
        </div>
      )}
      
      {loading ? (
        <div className="text-center py-8 text-white/70">Učitavanje...</div>
      ) : destinations.length === 0 ? (
        <div className="text-center py-12">
          <MapPin className="mx-auto h-12 w-12 text-slate-500 mb-4" />
          <h3 className="text-lg font-medium text-white mb-2">Nema destinacija</h3>
          <p className="text-slate-400">Dodajte prvu destinaciju.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {destinations.map((dest) => (
            <div key={`${dest.destinationCode}-${dest.airlineIata}`} className="bg-slate-800/50 rounded-xl shadow p-4 border border-slate-700/50">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="font-bold text-lg text-white">{dest.destinationCode}</h3>
                  <p className="text-slate-300">{dest.destinationName}</p>
                  <p className="text-sm text-slate-500">Avio kompanija: {dest.airlineIata}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEdit(dest)}
                    className="p-1 text-blue-400 hover:bg-blue-900/30 rounded transition-colors"
                    title="Izmeni"
                  >
                    <Edit size={18} />
                  </button>
                  <button
                    onClick={() => handleDelete(dest)}
                    className="p-1 text-red-400 hover:bg-red-900/30 rounded transition-colors"
                    title="Obriši"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
              
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-300">Business Class:</span>
                  <span className={`px-2 py-1 rounded text-xs ${dest.hasBusinessClass ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300'}`}>
                    {dest.hasBusinessClass ? 'DA' : 'NE'}
                  </span>
                </div>
                
                <div className="text-sm">
                  <div className="font-medium text-slate-300">Zimska sezona:</div>
                  <span className={dest.winterSchedule?.hasBusinessClass ? 'text-green-400' : 'text-red-400'}>
                    {dest.winterSchedule?.hasBusinessClass ? 'DA' : 'NE'}
                  </span>
                </div>
                
                <div className="text-sm">
                  <div className="font-medium text-slate-300">Letnja sezona:</div>
                  <span className={dest.summerSchedule?.hasBusinessClass ? 'text-green-400' : 'text-red-400'}>
                    {dest.summerSchedule?.hasBusinessClass ? 'DA' : 'NE'}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
  
  const renderForm = () => {
    if (!isModalOpen) return null;
    
    const title = editingId === 'new' 
      ? `Dodaj ${activeTab === 'airlines' ? 'avio kompaniju' : activeTab === 'flights' ? 'let' : 'destinaciju'}`
      : `Izmeni ${activeTab === 'airlines' ? 'avio kompaniju' : activeTab === 'flights' ? 'let' : 'destinaciju'}`;
    
    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
        <div className="bg-slate-900 rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-slate-700">
          <div className="p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-white">{title}</h2>
              <button
                type="button"
                onClick={handleCancel}
                className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="space-y-4">
              {activeTab === 'airlines' && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1 text-slate-300">IATA kod (2 slova)*</label>
                    <input
                      type="text"
                      maxLength={2}
                      value={formData.iataCode || ''}
                      onChange={(e) => setFormData({...formData, iataCode: e.target.value.toUpperCase()})}
                      className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="npr. JU"
                      disabled={editingId !== 'new'}
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium mb-1 text-slate-300">Naziv avio kompanije*</label>
                    <input
                      type="text"
                      value={formData.airlineName || ''}
                      onChange={(e) => setFormData({...formData, airlineName: e.target.value})}
                      className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="npr. Air Serbia"
                    />
                  </div>
                  
                  <div className="flex items-center p-3 bg-slate-800/50 rounded-lg">
                    <input
                      type="checkbox"
                      id="hasBusinessClass"
                      checked={formData.hasBusinessClass || false}
                      onChange={(e) => setFormData({...formData, hasBusinessClass: e.target.checked})}
                      className="mr-2 w-5 h-5 rounded border-slate-700 bg-slate-800 text-blue-500 focus:ring-blue-600"
                    />
                    <label htmlFor="hasBusinessClass" className="text-sm font-medium text-slate-300">
                      Uvek ima Business Class
                    </label>
                  </div>
                  
                  <div className="border-t border-slate-700 pt-4">
                    <h3 className="font-bold mb-2 text-slate-300">Zimska sezona (nov-mar)</h3>
                    <div className="space-y-3">
                      <div className="flex items-center p-3 bg-slate-800/50 rounded-lg">
                        <input
                          type="checkbox"
                          id="winterHasBusinessClass"
                          checked={formData.winterSchedule?.hasBusinessClass || false}
                          onChange={(e) => setFormData({
                            ...formData, 
                            winterSchedule: {
                              ...formData.winterSchedule,
                              hasBusinessClass: e.target.checked
                            }
                          })}
                          className="mr-2 w-5 h-5 rounded border-slate-700 bg-slate-800 text-blue-500 focus:ring-blue-600"
                        />
                        <label htmlFor="winterHasBusinessClass" className="text-sm font-medium text-slate-300">
                          Ima Business Class u zimu
                        </label>
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium mb-1 text-slate-300">Specijalni letovi (opciono)</label>
                        {(formData.winterSchedule?.specificFlights || []).map((flight: string, index: number) => (
                          <div key={index} className="flex gap-2 mb-2">
                            <input
                              type="text"
                              value={flight}
                              onChange={(e) => updateSpecificFlightValue('winter', index, e.target.value)}
                              className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                              placeholder="npr. JU683"
                            />
                            <button
                              type="button"
                              onClick={() => removeSpecificFlightInput('winter', index)}
                              className="px-3 text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded transition-colors"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => addSpecificFlightInput('winter')}
                          className="text-sm text-blue-400 hover:text-blue-300"
                        >
                          + Dodaj let
                        </button>
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium mb-1 text-slate-300">Dani u sedmici</label>
                        <div className="flex flex-wrap gap-2">
                          {DAYS_OF_WEEK.map(day => (
                            <button
                              key={day.id}
                              type="button"
                              onClick={() => toggleScheduleDay('winter', day.id)}
                              className={`px-3 py-1 rounded text-sm transition-colors ${
                                (formData.winterSchedule?.daysOfWeek || []).includes(day.id)
                                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                              }`}
                            >
                              {day.short}
                            </button>
                          ))}
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium mb-1 text-slate-300">Početak (opciono)</label>
                          <input
                            type="date"
                            value={formatDateForInput(formData.winterSchedule?.startDate)}
                            onChange={(e) => setFormData({
                              ...formData,
                              winterSchedule: {
                                ...formData.winterSchedule,
                                startDate: e.target.value || null
                              }
                            })}
                            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1 text-slate-300">Kraj (opciono)</label>
                          <input
                            type="date"
                            value={formatDateForInput(formData.winterSchedule?.endDate)}
                            onChange={(e) => setFormData({
                              ...formData,
                              winterSchedule: {
                                ...formData.winterSchedule,
                                endDate: e.target.value || null
                              }
                            })}
                            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="border-t border-slate-700 pt-4">
                    <h3 className="font-bold mb-2 text-slate-300">Letnja sezona</h3>
                    <div className="space-y-3">
                      <div className="flex items-center p-3 bg-slate-800/50 rounded-lg">
                        <input
                          type="checkbox"
                          id="summerHasBusinessClass"
                          checked={formData.summerSchedule?.hasBusinessClass || false}
                          onChange={(e) => setFormData({
                            ...formData,
                            summerSchedule: {
                              ...formData.summerSchedule,
                              hasBusinessClass: e.target.checked
                            }
                          })}
                          className="mr-2 w-5 h-5 rounded border-slate-700 bg-slate-800 text-blue-500 focus:ring-blue-600"
                        />
                        <label htmlFor="summerHasBusinessClass" className="text-sm font-medium text-slate-300">
                          Ima Business Class u leto
                        </label>
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium mb-1 text-slate-300">Specijalni letovi (opciono)</label>
                        {(formData.summerSchedule?.specificFlights || []).map((flight: string, index: number) => (
                          <div key={index} className="flex gap-2 mb-2">
                            <input
                              type="text"
                              value={flight}
                              onChange={(e) => updateSpecificFlightValue('summer', index, e.target.value)}
                              className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                              placeholder="npr. JU683"
                            />
                            <button
                              type="button"
                              onClick={() => removeSpecificFlightInput('summer', index)}
                              className="px-3 text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded transition-colors"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => addSpecificFlightInput('summer')}
                          className="text-sm text-blue-400 hover:text-blue-300"
                        >
                          + Dodaj let
                        </button>
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium mb-1 text-slate-300">Dani u sedmici</label>
                        <div className="flex flex-wrap gap-2">
                          {DAYS_OF_WEEK.map(day => (
                            <button
                              key={day.id}
                              type="button"
                              onClick={() => toggleScheduleDay('summer', day.id)}
                              className={`px-3 py-1 rounded text-sm transition-colors ${
                                (formData.summerSchedule?.daysOfWeek || []).includes(day.id)
                                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                              }`}
                            >
                              {day.short}
                            </button>
                          ))}
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium mb-1 text-slate-300">Početak (opciono)</label>
                          <input
                            type="date"
                            value={formatDateForInput(formData.summerSchedule?.startDate)}
                            onChange={(e) => setFormData({
                              ...formData,
                              summerSchedule: {
                                ...formData.summerSchedule,
                                startDate: e.target.value || null
                              }
                            })}
                            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1 text-slate-300">Kraj (opciono)</label>
                          <input
                            type="date"
                            value={formatDateForInput(formData.summerSchedule?.endDate)}
                            onChange={(e) => setFormData({
                              ...formData,
                              summerSchedule: {
                                ...formData.summerSchedule,
                                endDate: e.target.value || null
                              }
                            })}
                            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
              
              {activeTab === 'flights' && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1 text-slate-300">Broj leta*</label>
                    <input
                      type="text"
                      value={formData.flightNumber || ''}
                      onChange={(e) => setFormData({...formData, flightNumber: e.target.value})}
                      className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="npr. JU152"
                      disabled={editingId !== 'new'}
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium mb-1 text-slate-300">IATA kod avio kompanije*</label>
                    <input
                      type="text"
                      maxLength={2}
                      value={formData.airlineIata || ''}
                      onChange={(e) => setFormData({...formData, airlineIata: e.target.value.toUpperCase()})}
                      className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="npr. JU"
                    />
                  </div>
                  
                  <div className="flex items-center p-3 bg-slate-800/50 rounded-lg">
                    <input
                      type="checkbox"
                      id="alwaysBusinessClass"
                      checked={formData.alwaysBusinessClass || false}
                      onChange={(e) => setFormData({...formData, alwaysBusinessClass: e.target.checked})}
                      className="mr-2 w-5 h-5 rounded border-slate-700 bg-slate-800 text-blue-500 focus:ring-blue-600"
                    />
                    <label htmlFor="alwaysBusinessClass" className="text-sm font-medium text-slate-300">
                      Uvek ima Business Class
                    </label>
                  </div>
                  
                  <div className="flex gap-4 p-3 bg-slate-800/50 rounded-lg">
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        id="winterOnly"
                        checked={formData.winterOnly || false}
                        onChange={(e) => setFormData({...formData, winterOnly: e.target.checked, summerOnly: false})}
                        className="mr-2 w-5 h-5 rounded border-slate-700 bg-slate-800 text-blue-500 focus:ring-blue-600"
                      />
                      <label htmlFor="winterOnly" className="text-sm text-slate-300">Samo zimi</label>
                    </div>
                    
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        id="summerOnly"
                        checked={formData.summerOnly || false}
                        onChange={(e) => setFormData({...formData, summerOnly: e.target.checked, winterOnly: false})}
                        className="mr-2 w-5 h-5 rounded border-slate-700 bg-slate-800 text-blue-500 focus:ring-blue-600"
                      />
                      <label htmlFor="summerOnly" className="text-sm text-slate-300">Samo ljeti</label>
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium mb-1 text-slate-300">Dani u sedmici</label>
                    <div className="flex flex-wrap gap-2">
                      {DAYS_OF_WEEK.map(day => (
                        <button
                          key={day.id}
                          type="button"
                          onClick={() => toggleDay(day.id)}
                          className={`px-3 py-1 rounded text-sm transition-colors ${
                            (formData.daysOfWeek || []).includes(day.id)
                              ? 'bg-blue-600 text-white hover:bg-blue-700'
                              : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                          }`}
                        >
                          {day.short}
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-1 text-slate-300">Važi od (opciono)</label>
                      <input
                        type="date"
                        value={formatDateForInput(formData.validFrom)}
                        onChange={(e) => setFormData({...formData, validFrom: e.target.value || null})}
                        className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1 text-slate-300">Važi do (opciono)</label>
                      <input
                        type="date"
                        value={formatDateForInput(formData.validUntil)}
                        onChange={(e) => setFormData({...formData, validUntil: e.target.value || null})}
                        className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </>
              )}
              
              {activeTab === 'destinations' && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1 text-slate-300">IATA kod destinacije (3 slova)*</label>
                    <input
                      type="text"
                      maxLength={3}
                      value={formData.destinationCode || ''}
                      onChange={(e) => setFormData({...formData, destinationCode: e.target.value.toUpperCase()})}
                      className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="npr. BEG"
                      disabled={editingId !== 'new'}
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium mb-1 text-slate-300">Naziv destinacije*</label>
                    <input
                      type="text"
                      value={formData.destinationName || ''}
                      onChange={(e) => setFormData({...formData, destinationName: e.target.value})}
                      className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="npr. Beograd"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium mb-1 text-slate-300">IATA kod avio kompanije*</label>
                    <input
                      type="text"
                      maxLength={2}
                      value={formData.airlineIata || ''}
                      onChange={(e) => setFormData({...formData, airlineIata: e.target.value.toUpperCase()})}
                      className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="npr. JU"
                    />
                  </div>
                  
                  <div className="flex items-center p-3 bg-slate-800/50 rounded-lg">
                    <input
                      type="checkbox"
                      id="destHasBusinessClass"
                      checked={formData.hasBusinessClass || false}
                      onChange={(e) => setFormData({...formData, hasBusinessClass: e.target.checked})}
                      className="mr-2 w-5 h-5 rounded border-slate-700 bg-slate-800 text-blue-500 focus:ring-blue-600"
                    />
                    <label htmlFor="destHasBusinessClass" className="text-sm font-medium text-slate-300">
                      Uvek ima Business Class
                    </label>
                  </div>
                  
                  <div className="border-t border-slate-700 pt-4">
                    <h3 className="font-bold mb-2 text-slate-300">Zimska sezona</h3>
                    <div className="space-y-3">
                      <div className="flex items-center p-3 bg-slate-800/50 rounded-lg">
                        <input
                          type="checkbox"
                          id="destWinterHasBusinessClass"
                          checked={formData.winterSchedule?.hasBusinessClass || false}
                          onChange={(e) => setFormData({
                            ...formData,
                            winterSchedule: {
                              ...formData.winterSchedule,
                              hasBusinessClass: e.target.checked
                            }
                          })}
                          className="mr-2 w-5 h-5 rounded border-slate-700 bg-slate-800 text-blue-500 focus:ring-blue-600"
                        />
                        <label htmlFor="destWinterHasBusinessClass" className="text-sm font-medium text-slate-300">
                          Ima Business Class u zimu
                        </label>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium mb-1 text-slate-300">Početak (opciono)</label>
                          <input
                            type="date"
                            value={formatDateForInput(formData.winterSchedule?.startDate)}
                            onChange={(e) => setFormData({
                              ...formData,
                              winterSchedule: {
                                ...formData.winterSchedule,
                                startDate: e.target.value || null
                              }
                            })}
                            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1 text-slate-300">Kraj (opciono)</label>
                          <input
                            type="date"
                            value={formatDateForInput(formData.winterSchedule?.endDate)}
                            onChange={(e) => setFormData({
                              ...formData,
                              winterSchedule: {
                                ...formData.winterSchedule,
                                endDate: e.target.value || null
                              }
                            })}
                            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="border-t border-slate-700 pt-4">
                    <h3 className="font-bold mb-2 text-slate-300">Letnja sezona</h3>
                    <div className="space-y-3">
                      <div className="flex items-center p-3 bg-slate-800/50 rounded-lg">
                        <input
                          type="checkbox"
                          id="destSummerHasBusinessClass"
                          checked={formData.summerSchedule?.hasBusinessClass || false}
                          onChange={(e) => setFormData({
                            ...formData,
                            summerSchedule: {
                              ...formData.summerSchedule,
                              hasBusinessClass: e.target.checked
                            }
                          })}
                          className="mr-2 w-5 h-5 rounded border-slate-700 bg-slate-800 text-blue-500 focus:ring-blue-600"
                        />
                        <label htmlFor="destSummerHasBusinessClass" className="text-sm font-medium text-slate-300">
                          Ima Business Class u leto
                        </label>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium mb-1 text-slate-300">Početak (opciono)</label>
                          <input
                            type="date"
                            value={formatDateForInput(formData.summerSchedule?.startDate)}
                            onChange={(e) => setFormData({
                              ...formData,
                              summerSchedule: {
                                ...formData.summerSchedule,
                                startDate: e.target.value || null
                              }
                            })}
                            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1 text-slate-300">Kraj (opciono)</label>
                          <input
                            type="date"
                            value={formatDateForInput(formData.summerSchedule?.endDate)}
                            onChange={(e) => setFormData({
                              ...formData,
                              summerSchedule: {
                                ...formData.summerSchedule,
                                endDate: e.target.value || null
                              }
                            })}
                            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-6 border-t border-slate-700 mt-6">
              <button
                type="button"
                onClick={handleCancel}
                className="px-4 py-2 text-slate-400 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-colors"
              >
                Otkaži
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 transition-colors"
              >
                <Save size={18} />
                Sačuvaj
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };
  
  const currentSeason = getCurrentSeason();
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-white">Konfiguracija Business Class sistema</h1>
          <p className="text-slate-300 mt-2">
            Trenutna sezona: <span className="font-semibold capitalize">{currentSeason === 'winter' ? 'ZIMA' : 'LETO'}</span>
          </p>
          <p className="text-slate-400">
            Konfigurišite koje letove imaju business class check-in na osnovu avio kompanije, specifičnih letova i destinacija
          </p>
        </header>
        
        {/* Tabs */}
        <div className="mb-6 border-b border-slate-700">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('airlines')}
              className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'airlines'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-400 hover:border-slate-600'
              }`}
            >
              <Building className="inline-block w-4 h-4 mr-2" />
              Avio kompanije
            </button>
            <button
              onClick={() => setActiveTab('flights')}
              className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'flights'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-400 hover:border-slate-600'
              }`}
            >
              <Plane className="inline-block w-4 h-4 mr-2" />
              Specijalni letovi
            </button>
            <button
              onClick={() => setActiveTab('destinations')}
              className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'destinations'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-400 hover:border-slate-600'
              }`}
            >
              <MapPin className="inline-block w-4 h-4 mr-2" />
              Destinacije
            </button>
          </nav>
        </div>
        
        {/* Content */}
        {activeTab === 'airlines' && renderAirlinesTab()}
        {activeTab === 'flights' && renderFlightsTab()}
        {activeTab === 'destinations' && renderDestinationsTab()}
      </div>
      
      {/* Form Modal */}
      {renderForm()}
    </div>
  );
}