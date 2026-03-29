// lib/business-class-service.ts

// Tipovi
export interface Airline {
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

export interface SpecificFlight {
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

export interface Destination {
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

export interface CreateAirlineData {
  iataCode: string;
  airlineName: string;
  hasBusinessClass: boolean;
  winterSchedule?: {
    hasBusinessClass: boolean;
    specificFlights: string[];
    daysOfWeek: number[];
    startDate: string | null;
    endDate: string | null;
  };
  summerSchedule?: {
    hasBusinessClass: boolean;
    specificFlights: string[];
    daysOfWeek: number[];
    startDate: string | null;
    endDate: string | null;
  };
}

export interface UpdateAirlineData extends Partial<CreateAirlineData> {}

export interface CreateFlightData {
  flightNumber: string;
  airlineIata: string;
  alwaysBusinessClass: boolean;
  winterOnly: boolean;
  summerOnly: boolean;
  daysOfWeek: number[];
  validFrom: string | null;
  validUntil: string | null;
}

export interface UpdateFlightData extends Partial<CreateFlightData> {}

export interface CreateDestinationData {
  destinationCode: string;
  destinationName: string;
  airlineIata: string;
  hasBusinessClass: boolean;
  winterSchedule?: {
    hasBusinessClass: boolean;
    startDate: string | null;
    endDate: string | null;
  };
  summerSchedule?: {
    hasBusinessClass: boolean;
    startDate: string | null;
    endDate: string | null;
  };
}

export interface UpdateDestinationData extends Partial<CreateDestinationData> {}

// Helper funkcija za hendlovanje fetch grešaka
async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorMessage = `HTTP error! status: ${response.status}`;
    try {
      const errorData = await response.json();
      errorMessage = errorData.error || errorMessage;
    } catch {
      // Ignorišemo ako nije JSON
    }
    throw new Error(errorMessage);
  }
  
  try {
    return await response.json();
  } catch (error) {
    throw new Error('Invalid JSON response');
  }
}

// AVIO KOMPANIJE
export async function getAllAirlines(): Promise<Airline[]> {
  try {
    const timestamp = Date.now();
    const response = await fetch(`/api/admin/airlines?t=${timestamp}`, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });
    return await handleResponse<Airline[]>(response);
  } catch (error) {
    console.error('Error fetching airlines:', error);
    throw error;
  }
}

export async function getAirlineByIata(iataCode: string): Promise<Airline | null> {
  try {
    const timestamp = Date.now();
    const response = await fetch(`/api/admin/airlines/${iataCode}?t=${timestamp}`, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });
    
    if (response.status === 404) {
      return null;
    }
    
    return await handleResponse<Airline>(response);
  } catch (error) {
    console.error('Error fetching airline:', error);
    throw error;
  }
}

export async function createAirline(data: CreateAirlineData): Promise<Airline> {
  try {
    const response = await fetch('/api/admin/airlines', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    
    return await handleResponse<Airline>(response);
  } catch (error) {
    console.error('Error creating airline:', error);
    throw error;
  }
}

export async function updateAirline(iataCode: string, data: UpdateAirlineData): Promise<Airline> {
  try {
    const response = await fetch(`/api/admin/airlines/${iataCode}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify(data),
      cache: 'no-store'
    });
    
    return await handleResponse<Airline>(response);
  } catch (error) {
    console.error('Error updating airline:', error);
    throw error;
  }
}

export async function deleteAirline(iataCode: string): Promise<{ success: boolean }> {
  try {
    const response = await fetch(`/api/admin/airlines/${iataCode}`, {
      method: 'DELETE',
    });
    
    return await handleResponse<{ success: boolean }>(response);
  } catch (error) {
    console.error('Error deleting airline:', error);
    throw error;
  }
}

// SPECIFIČNI LETOVI
export async function getAllSpecificFlights(): Promise<SpecificFlight[]> {
  try {
    const timestamp = Date.now();
    const response = await fetch(`/api/admin/specific-flights?t=${timestamp}`, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });
    return await handleResponse<SpecificFlight[]>(response);
  } catch (error) {
    console.error('Error fetching specific flights:', error);
    throw error;
  }
}

export async function getSpecificFlight(flightNumber: string): Promise<SpecificFlight | null> {
  try {
    const timestamp = Date.now();
    const response = await fetch(`/api/admin/specific-flights/${flightNumber}?t=${timestamp}`, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });
    
    if (response.status === 404) {
      return null;
    }
    
    return await handleResponse<SpecificFlight>(response);
  } catch (error) {
    console.error('Error fetching specific flight:', error);
    throw error;
  }
}

export async function createSpecificFlight(data: CreateFlightData): Promise<SpecificFlight> {
  try {
    const response = await fetch('/api/admin/specific-flights', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    
    return await handleResponse<SpecificFlight>(response);
  } catch (error) {
    console.error('Error creating specific flight:', error);
    throw error;
  }
}

export async function updateSpecificFlight(flightNumber: string, data: UpdateFlightData): Promise<SpecificFlight> {
  try {
    console.log('=== UPDATE SPECIFIC FLIGHT SERVICE CALLED ===');
    console.log('Flight number to update:', flightNumber);
    console.log('Data to send:', JSON.stringify(data, null, 2));
    
    const encodedFlightNumber = encodeURIComponent(flightNumber);
    console.log('Encoded flight number for URL:', encodedFlightNumber);
    
    const response = await fetch(`/api/admin/specific-flights/${encodedFlightNumber}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify(data),
      cache: 'no-store'
    });
    
    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error response text:', errorText);
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const result = await response.json();
    console.log('Update successful, response:', result);
    return result;
    
  } catch (error) {
    console.error('=== UPDATE SPECIFIC FLIGHT ERROR ===');
    console.error('Error details:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    throw error;
  }
}

export async function deleteSpecificFlight(flightNumber: string): Promise<{ success: boolean }> {
  try {
    console.log('=== DELETE SPECIFIC FLIGHT SERVICE CALLED ===');
    console.log('Flight number to delete:', flightNumber);
    
    const encodedFlightNumber = encodeURIComponent(flightNumber);
    console.log('Encoded flight number for URL:', encodedFlightNumber);
    
    const response = await fetch(`/api/admin/specific-flights/${encodedFlightNumber}`, {
      method: 'DELETE',
    });
    
    console.log('Response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error response text:', errorText);
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const result = await response.json();
    console.log('Delete successful, response:', result);
    return result;
    
  } catch (error) {
    console.error('=== DELETE SPECIFIC FLIGHT ERROR ===');
    console.error('Error details:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
    }
    throw error;
  }
}


// DESTINACIJE
export async function getAllDestinations(): Promise<Destination[]> {
  try {
    const timestamp = Date.now();
    const response = await fetch(`/api/admin/destinations?t=${timestamp}`, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });
    return await handleResponse<Destination[]>(response);
  } catch (error) {
    console.error('Error fetching destinations:', error);
    throw error;
  }
}

export async function getDestinationsByAirline(airlineIata: string): Promise<Destination[]> {
  try {
    const allDestinations = await getAllDestinations();
    return allDestinations.filter(dest => dest.airlineIata === airlineIata);
  } catch (error) {
    console.error('Error fetching destinations by airline:', error);
    throw error;
  }
}

export async function getDestination(destinationCode: string, airlineIata: string): Promise<Destination | null> {
  try {
    const timestamp = Date.now();
    const response = await fetch(`/api/admin/destinations/${destinationCode}/${airlineIata}?t=${timestamp}`, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });
    
    if (response.status === 404) {
      return null;
    }
    
    return await handleResponse<Destination>(response);
  } catch (error) {
    console.error('Error fetching destination:', error);
    throw error;
  }
}

export async function createDestination(data: CreateDestinationData): Promise<Destination> {
  try {
    const response = await fetch('/api/admin/destinations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    
    return await handleResponse<Destination>(response);
  } catch (error) {
    console.error('Error creating destination:', error);
    throw error;
  }
}

export async function updateDestination(
  destinationCode: string, 
  airlineIata: string, 
  data: UpdateDestinationData
): Promise<Destination> {
  try {
    const response = await fetch(`/api/admin/destinations/${destinationCode}/${airlineIata}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify(data),
      cache: 'no-store'
    });
    
    return await handleResponse<Destination>(response);
  } catch (error) {
    console.error('Error updating destination:', error);
    throw error;
  }
}

export async function deleteDestination(
  destinationCode: string, 
  airlineIata: string
): Promise<{ success: boolean }> {
  try {
    const response = await fetch(`/api/admin/destinations/${destinationCode}/${airlineIata}`, {
      method: 'DELETE',
    });
    
    if (response.status === 404) {
      console.log(`Destination ${destinationCode}-${airlineIata} not found, might have been already deleted`);
      return { success: true };
    }
    
    if (!response.ok) {
      let errorMessage = `HTTP error! status: ${response.status}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorMessage;
      } catch {
        // Ignorišemo ako nije JSON
      }
      throw new Error(errorMessage);
    }
    
    try {
      return await response.json();
    } catch (error) {
      return { success: true };
    }
    
  } catch (error) {
    console.error('Error deleting destination:', error);
    throw error;
  }
}

// UTILITY FUNKCIJE
export function getCurrentSeason(): 'winter' | 'summer' {
  const now = new Date();
  const month = now.getMonth() + 1;
  
  if (month === 11 || month === 12 || month === 1 || month === 2 || month === 3) {
    return 'winter';
  }
  
  return 'summer';
}

export async function initializeDefaultData(): Promise<void> {
  try {
    const existingAirlines = await getAllAirlines();
    
    if (existingAirlines.length > 0) {
      console.log('Default data already exists');
      return;
    }
    
    const airSerbiaData: CreateAirlineData = {
      iataCode: 'JU',
      airlineName: 'Air Serbia',
      hasBusinessClass: true,
      winterSchedule: {
        hasBusinessClass: true,
        specificFlights: ['JU683'],
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startDate: null,
        endDate: null
      },
      summerSchedule: {
        hasBusinessClass: true,
        specificFlights: ['JU683'],
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startDate: null,
        endDate: null
      }
    };
    
    await createAirline(airSerbiaData);
    
    const turkishAirlinesData: CreateAirlineData = {
      iataCode: 'TK',
      airlineName: 'Turkish Airlines',
      hasBusinessClass: true,
      winterSchedule: {
        hasBusinessClass: true,
        specificFlights: ['TK1089'],
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startDate: null,
        endDate: null
      },
      summerSchedule: {
        hasBusinessClass: true,
        specificFlights: ['TK1089'],
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startDate: null,
        endDate: null
      }
    };
    
    await createAirline(turkishAirlinesData);
    
    const defaultFlights: CreateFlightData[] = [
      {
        flightNumber: 'JU683',
        airlineIata: 'JU',
        alwaysBusinessClass: true,
        winterOnly: false,
        summerOnly: false,
        daysOfWeek: [1, 2, 3, 4, 5],
        validFrom: null,
        validUntil: null
      },
      {
        flightNumber: 'TK1089',
        airlineIata: 'TK',
        alwaysBusinessClass: true,
        winterOnly: false,
        summerOnly: false,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        validFrom: null,
        validUntil: null
      }
    ];
    
    for (const flightData of defaultFlights) {
      await createSpecificFlight(flightData);
    }
    
    const defaultDestinations: CreateDestinationData[] = [
      {
        destinationCode: 'BEG',
        destinationName: 'Beograd',
        airlineIata: 'JU',
        hasBusinessClass: false,
        winterSchedule: {
          hasBusinessClass: false,
          startDate: null,
          endDate: null
        },
        summerSchedule: {
          hasBusinessClass: true,
          startDate: null,
          endDate: null
        }
      },
      {
        destinationCode: 'IST',
        destinationName: 'Istanbul',
        airlineIata: 'TK',
        hasBusinessClass: true,
        winterSchedule: {
          hasBusinessClass: true,
          startDate: null,
          endDate: null
        },
        summerSchedule: {
          hasBusinessClass: true,
          startDate: null,
          endDate: null
        }
      }
    ];
    
    for (const destinationData of defaultDestinations) {
      await createDestination(destinationData);
    }
    
    console.log('Default data initialized successfully');
  } catch (error) {
    console.error('Error initializing default data:', error);
    throw error;
  }
}

export async function hasBusinessClass(
  airlineIata: string,
  flightNumber?: string,
  destinationCode?: string,
  date?: Date
): Promise<boolean> {
  try {
    const now = date || new Date();
    const month = now.getMonth() + 1;
    const dayOfWeek = now.getDay();
    const isWinter = month === 11 || month === 12 || month === 1 || month === 2 || month === 3;

    // 1. PRIORITET: Proveri specifične letove
    if (flightNumber) {
      const specificFlights = await getAllSpecificFlights();
      const flight = specificFlights.find(f => 
        f.flightNumber === flightNumber && f.airlineIata === airlineIata
      );

      if (flight) {
        // Sezonska provera
        if (flight.winterOnly && !isWinter) return false;
        if (flight.summerOnly && isWinter) return false;

        // Dan u nedelji
        if (flight.daysOfWeek.length > 0 && !flight.daysOfWeek.includes(dayOfWeek)) {
          return false;
        }

        // Datumski opseg
        if (flight.validFrom && new Date(flight.validFrom) > now) return false;
        if (flight.validUntil && new Date(flight.validUntil) < now) return false;

        return flight.alwaysBusinessClass;
      }
    }

    // 2. PRIORITET: Proveri destinacije
    if (destinationCode) {
      const destinations = await getAllDestinations();
      const destination = destinations.find(d => 
        d.destinationCode === destinationCode && d.airlineIata === airlineIata
      );

      if (destination) {
        if (destination.hasBusinessClass) return true;

        const schedule = isWinter ? destination.winterSchedule : destination.summerSchedule;
        if (schedule.hasBusinessClass) {
          if (schedule.startDate && new Date(schedule.startDate) > now) return false;
          if (schedule.endDate && new Date(schedule.endDate) < now) return false;
          return true;
        }
      }
    }

    // 3. PRIORITET: Proveri aviokompaniju - ALI SAMO AKO NEMA SPECIFIČNIH LETOVA
    const airline = await getAirlineByIata(airlineIata);
    if (!airline) return false;

    // **KLJUČNA IZMENA**: Ako postoje specifični letovi za ovu aviokompaniju,
    // NE vraćaj true za sve letove, već samo za one koji su eksplicitno navedeni
    if (flightNumber) {
      const specificFlights = await getAllSpecificFlights();
      const hasAnySpecificFlights = specificFlights.some(f => f.airlineIata === airlineIata);
      
      // Ako aviokompanija ima definisane specifične letove, a ovaj let nije među njima,
      // znači da NEMA business class
      if (hasAnySpecificFlights) {
        return false;
      }
    }

    // Ako nema specifičnih letova za ovu aviokompaniju, koristi opšta pravila
    if (airline.hasBusinessClass) return true;

    const schedule = isWinter ? airline.winterSchedule : airline.summerSchedule;
    if (schedule.hasBusinessClass) {
      if (schedule.daysOfWeek.length > 0 && !schedule.daysOfWeek.includes(dayOfWeek)) {
        return false;
      }

      if (flightNumber && schedule.specificFlights.length > 0) {
        return schedule.specificFlights.includes(flightNumber);
      }

      if (schedule.startDate && new Date(schedule.startDate) > now) return false;
      if (schedule.endDate && new Date(schedule.endDate) < now) return false;

      return true;
    }

    return false;
  } catch (error) {
    console.error('Error checking business class:', error);
    return false;
  }
}