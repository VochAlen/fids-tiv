import { sqliteTable, text, integer, blob } from 'drizzle-orm/sqlite-core';

// Tabela za IATA kodove kompanija koje imaju business class
export const airlinesTable = sqliteTable('airlines', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  iataCode: text('iata_code').notNull().unique(), // npr. 'JU'
  airlineName: text('airline_name').notNull(),
  hasBusinessClass: integer('has_business_class', { mode: 'boolean' }).default(false),
  
  // Sezonska podešavanja za zimu
  winterSchedule: blob('winter_schedule', { mode: 'json' }).$type<{
    hasBusinessClass: boolean;
    specificFlights: string[]; // npr. ['JU152', 'JU153']
    daysOfWeek: number[]; // 0 = nedelja, 1 = ponedeljak...
    startDate: string | null; // ISO format
    endDate: string | null; // ISO format
  }>().default({ 
    hasBusinessClass: false, 
    specificFlights: [], 
    daysOfWeek: [], 
    startDate: null, 
    endDate: null 
  }),
  
  // Sezonska podešavanja za leto
  summerSchedule: blob('summer_schedule', { mode: 'json' }).$type<{
    hasBusinessClass: boolean;
    specificFlights: string[];
    daysOfWeek: number[];
    startDate: string | null;
    endDate: string | null;
  }>().default({ 
    hasBusinessClass: false, 
    specificFlights: [], 
    daysOfWeek: [], 
    startDate: null, 
    endDate: null 
  }),
  
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Tabela za specificne letove koji uvek imaju business class
export const specificFlightsTable = sqliteTable('specific_flights', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  flightNumber: text('flight_number').notNull(), // npr. 'JU152'
  airlineIata: text('airline_iata').notNull(),
  alwaysBusinessClass: integer('always_business_class', { mode: 'boolean' }).default(false),
  
  // Sezonska ograničenja
  winterOnly: integer('winter_only', { mode: 'boolean' }).default(false),
  summerOnly: integer('summer_only', { mode: 'boolean' }).default(false),
  
  // Dani u nedelji
  daysOfWeek: blob('days_of_week', { mode: 'json' }).$type<number[]>().default([]),
  
  // Datumski opseg
  validFrom: integer('valid_from', { mode: 'timestamp' }),
  validUntil: integer('valid_until', { mode: 'timestamp' }),
  
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Tabela za destinacije koje imaju business class
export const destinationsTable = sqliteTable('destinations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  destinationCode: text('destination_code').notNull(), // IATA kod destinacije
  destinationName: text('destination_name').notNull(),
  airlineIata: text('airline_iata').notNull(),
  hasBusinessClass: integer('has_business_class', { mode: 'boolean' }).default(false),
  
  // Sezonska podešavanja za zimu
  winterSchedule: blob('winter_schedule', { mode: 'json' }).$type<{
    hasBusinessClass: boolean;
    startDate: string | null;
    endDate: string | null;
  }>().default({ 
    hasBusinessClass: false, 
    startDate: null, 
    endDate: null 
  }),
  
  // Sezonska podešavanja za leto
  summerSchedule: blob('summer_schedule', { mode: 'json' }).$type<{
    hasBusinessClass: boolean;
    startDate: string | null;
    endDate: string | null;
  }>().default({ 
    hasBusinessClass: false, 
    startDate: null, 
    endDate: null 
  }),
  
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Tabela za logovanje promena
export const changeLogTable = sqliteTable('change_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  action: text('action').notNull(), // 'CREATE', 'UPDATE', 'DELETE'
  tableName: text('table_name').notNull(), // 'airlines', 'specific_flights', 'destinations'
  recordId: integer('record_id').notNull(),
  oldData: blob('old_data', { mode: 'json' }),
  newData: blob('new_data', { mode: 'json' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});


// Tipovi za TypeScript
export type Airline = typeof airlinesTable.$inferSelect;
export type InsertAirline = typeof airlinesTable.$inferInsert;
export type UpdateAirline = Partial<InsertAirline>;

export type SpecificFlight = typeof specificFlightsTable.$inferSelect;
export type InsertSpecificFlight = typeof specificFlightsTable.$inferInsert;
export type UpdateSpecificFlight = Partial<InsertSpecificFlight>;

export type Destination = typeof destinationsTable.$inferSelect;
export type InsertDestination = typeof destinationsTable.$inferInsert;
export type UpdateDestination = Partial<InsertDestination>;

// Helper interfejsi za JSON polja
export interface SeasonSchedule {
  hasBusinessClass: boolean;
  specificFlights: string[];
  daysOfWeek: number[];
  startDate: string | null;
  endDate: string | null;
}

export interface DestinationSeasonSchedule {
  hasBusinessClass: boolean;
  startDate: string | null;
  endDate: string | null;
}