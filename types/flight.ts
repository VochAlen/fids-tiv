// types/flight.ts

export interface Flight {
  id: string;
  FlightNumber: string;
  AirlineCode: string;
  AirlineICAO: string;
  AirlineName: string;
  DestinationAirportName: string;
  DestinationAirportCode: string;
  ScheduledDepartureTime: string;
  EstimatedDepartureTime: string;
  ActualDepartureTime: string;
  StatusEN: string;
  StatusMN?: string;
  Terminal: string;
  GateNumber: string;
  GateNumbers?: string[];
  CheckInDesk: string;
  CheckInDesks?: string[];
  BaggageReclaim: string;
  CodeShareFlights: string[];
  AirlineLogoURL: string;
  
  FlightType: 'departure' | 'arrival';
  DestinationCityName: string;
  
  // Nova polja za backup i auto-processing sistem
  IsBackupData?: boolean;
  AutoProcessed?: boolean;
  ProcessingStage?: 'none' | 'checkin' | 'boarding' | 'closed' | 'departed' | 'arrived';
  LastStatusUpdate?: string;
  OriginalStatus?: string;
  IsOfflineMode?: boolean;
  BackupTimestamp?: string;
  
  // Polja za admin dashboard
  Airline?: string;
  Destination?: string;
  Origin?: string;
  ScheduleTime?: string;
  Status?: string;
  Gate?: string;
  
  // 🔴 NOVA POLJA za manual override i check-in management 🔴
  _id?: string; // MongoDB ID
  manualOverride?: {
    status: string;
    checkInStatus: 'open' | 'closed' | 'cancelled' | 'diverted' | 'auto';
    updatedBy: string;
    updatedAt: Date;
    notes?: string;
    reason?: string;
  };
  
  checkInDesks?: {
    [deskNumber: string]: {
      isOpen: boolean;
      openedAt?: Date;
      closedAt?: Date;
      openedBy?: string;
      closedBy?: string;
      manualOverride?: boolean;
      notes?: string;
    };
  };
  
  adminNotes?: {
    text: string;
    createdBy: string;
    createdAt: Date;
    updatedAt?: Date;
  }[];
  
  // Tracking za audit
  lastModifiedBy?: string;
  lastModifiedAt?: Date;
  modificationCount?: number;
}

// Enhanced flight sa dodatnim metapodacima
export interface EnhancedFlight extends Flight {
  _allDesks?: string[];
  _deskIndex?: number;
  _isManualOverride?: boolean;
  _overrideDetails?: {
    type: 'status' | 'checkin' | 'gate' | 'all';
    active: boolean;
    expiresAt?: Date;
  };
}

export interface FlightData {
  departures: Flight[];
  arrivals: Flight[];
  lastUpdated: string;
  source?: 'live' | 'cached' | 'fallback' | 'backup' | 'auto-processed' | 'emergency';
  error?: string;
  warning?: string;
  backupTimestamp?: string;
  autoProcessedCount?: number;
  isOfflineMode?: boolean;
  totalFlights: number;
  // Dodajte info o manual overrides
  manualOverrides?: {
    count: number;
    flights: string[];
  };
}

export interface RawFlightData {
  Updateovano: string;
  Datum: string;
  Dan: string;
  TipLeta: string;
  KompanijaNaziv: string;
  Logo: string;
  Kompanija: string;
  KompanijaICAO: string;
  BrojLeta: string;
  CodeShare: string;
  IATA: string;
  Grad: string;
  Planirano: string;
  Predvidjeno: string;
  Aktuelno: string;
  Terminal: string;
  Karusel: string;
  CheckIn: string;
  Gate: string;
  Aerodrom: string;
  Status: string;
  Via: string;
  StatusEN: string;
  StatusMN: string;
}

// Tip za admin dashboard API response
export interface ApiResponse {
  departures: Flight[];
  arrivals: Flight[];
  totalFlights: number;
  lastUpdated: string;
  source: string;
  isOfflineMode?: boolean;
  manualOverrides?: {
    count: number;
    flights: string[];
  };
}

// 🔴 NOVI TIPOVI za manual override sistem 🔴
export interface ManualOverridePayload {
  flightNumber: string;
  scheduledTime: string;
  action: 'override-status' | 'open-checkin' | 'close-checkin' | 
          'open-all-desks' | 'close-all-desks' | 'clear-override' |
          'add-note' | 'update-gate' | 'update-terminal';
  data: {
    status?: string;
    checkInStatus?: 'open' | 'closed' | 'cancelled' | 'diverted';
    deskNumber?: string;
    notes?: string;
    reason?: string;
    gate?: string;
    terminal?: string;
    noteText?: string;
  };
}

export interface OverrideResponse {
  success: boolean;
  message: string;
  flight?: Flight;
  updatedFields?: string[];
}

export interface CheckInDeskStatus {
  deskNumber: string;
  isOpen: boolean;
  flightNumber: string;
  lastAction: 'opened' | 'closed';
  lastActionBy: string;
  lastActionAt: Date;
  manualOverride: boolean;
}

export interface AuditLog {
  _id?: string;
  adminId: string;
  adminUsername: string;
  action: string;
  entity: 'flight' | 'checkin-desk' | 'system';
  entityId: string;
  details: any;
  timestamp: Date;
  ipAddress: string;
  userAgent?: string;
}

// Tip za admin dashboard filtere
export interface AdminFilters {
  searchTerm: string;
  airlineFilter: string;
  statusFilter: string;
  flightType: 'all' | 'departures' | 'arrivals';
  showManualOnly: boolean;
  showCheckInOpen: boolean;
  dateRange?: {
    from: Date;
    to: Date;
  };
}