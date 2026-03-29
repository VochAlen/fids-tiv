// scripts/init-db.js
const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');

// Kreirajte data folder ako ne postoji
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Putanja do SQLite baze
const dbPath = path.join(dataDir, 'flights.db');
console.log(`Creating database at: ${dbPath}`);

// Kreirajte libsql klijent
const db = createClient({
  url: `file:${dbPath}`,
});

async function init() {
  // Kreirajte tabele
  console.log('Creating tables...');
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS airlines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      iata_code TEXT NOT NULL UNIQUE,
      airline_name TEXT NOT NULL,
      has_business_class INTEGER DEFAULT 0,
      winter_schedule TEXT DEFAULT '{"hasBusinessClass":false,"specificFlights":[],"daysOfWeek":[],"startDate":null,"endDate":null}',
      summer_schedule TEXT DEFAULT '{"hasBusinessClass":false,"specificFlights":[],"daysOfWeek":[],"startDate":null,"endDate":null}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS specific_flights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      flight_number TEXT NOT NULL,
      airline_iata TEXT NOT NULL,
      always_business_class INTEGER DEFAULT 0,
      winter_only INTEGER DEFAULT 0,
      summer_only INTEGER DEFAULT 0,
      days_of_week TEXT DEFAULT '[]',
      valid_from DATETIME,
      valid_until DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS destinations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      destination_code TEXT NOT NULL,
      destination_name TEXT NOT NULL,
      airline_iata TEXT NOT NULL,
      has_business_class INTEGER DEFAULT 0,
      winter_schedule TEXT DEFAULT '{"hasBusinessClass":false,"startDate":null,"endDate":null}',
      summer_schedule TEXT DEFAULT '{"hasBusinessClass":false,"startDate":null,"endDate":null}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(destination_code, airline_iata)
    );
  `);

  // Dodajte podrazumevane podatke
  console.log('Adding default data...');

  // Air Serbia
  await db.execute({
    sql: `INSERT OR IGNORE INTO airlines (iata_code, airline_name, has_business_class, winter_schedule, summer_schedule)
          VALUES (?, ?, ?, ?, ?)`,
    args: [
      'JU', 'Air Serbia', 1,
      JSON.stringify({ hasBusinessClass: true, specificFlights: ['JU683'], daysOfWeek: [0,1,2,3,4,5,6], startDate: null, endDate: null }),
      JSON.stringify({ hasBusinessClass: true, specificFlights: ['JU683'], daysOfWeek: [0,1,2,3,4,5,6], startDate: null, endDate: null })
    ]
  });

  // Turkish Airlines
  await db.execute({
    sql: `INSERT OR IGNORE INTO airlines (iata_code, airline_name, has_business_class, winter_schedule, summer_schedule)
          VALUES (?, ?, ?, ?, ?)`,
    args: [
      'TK', 'Turkish Airlines', 1,
      JSON.stringify({ hasBusinessClass: true, specificFlights: ['TK1021', 'TK1022'], daysOfWeek: [0,1,2,3,4,5,6], startDate: null, endDate: null }),
      JSON.stringify({ hasBusinessClass: true, specificFlights: ['TK1021', 'TK1022', 'TK1023'], daysOfWeek: [0,1,2,3,4,5,6], startDate: null, endDate: null })
    ]
  });

  // Specifični letovi
  await db.execute({
    sql: `INSERT OR IGNORE INTO specific_flights (flight_number, airline_iata, always_business_class, winter_only, summer_only, days_of_week, valid_from, valid_until)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: ['JU683', 'JU', 1, 0, 0, JSON.stringify([0,1,2,3,4,5,6]), null, null]
  });

  await db.execute({
    sql: `INSERT OR IGNORE INTO specific_flights (flight_number, airline_iata, always_business_class, winter_only, summer_only, days_of_week, valid_from, valid_until)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: ['4O400', '4O', 1, 0, 0, JSON.stringify([0,1,2,3,4,5,6]), null, null]
  });

  await db.execute({
    sql: `INSERT OR IGNORE INTO specific_flights (flight_number, airline_iata, always_business_class, winter_only, summer_only, days_of_week, valid_from, valid_until)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: ['TK1089', 'TK', 1, 0, 0, JSON.stringify([0,1,2,3,4,5]), null, null]
  });

  // Destinacije
  await db.execute({
    sql: `INSERT OR IGNORE INTO destinations (destination_code, destination_name, airline_iata, has_business_class, winter_schedule, summer_schedule)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      'BEG', 'Beograd', 'JU', 1,
      JSON.stringify({ hasBusinessClass: true, startDate: null, endDate: null }),
      JSON.stringify({ hasBusinessClass: true, startDate: null, endDate: null })
    ]
  });

  await db.execute({
    sql: `INSERT OR IGNORE INTO destinations (destination_code, destination_name, airline_iata, has_business_class, winter_schedule, summer_schedule)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      'IST', 'Istanbul', 'TK', 1,
      JSON.stringify({ hasBusinessClass: true, startDate: null, endDate: null }),
      JSON.stringify({ hasBusinessClass: true, startDate: null, endDate: null })
    ]
  });

  // Proverite podatke
  console.log('\n=== Database Summary ===');
  const airlineCount = await db.execute('SELECT COUNT(*) as count FROM airlines');
  const flightCount = await db.execute('SELECT COUNT(*) as count FROM specific_flights');
  const destCount = await db.execute('SELECT COUNT(*) as count FROM destinations');

  console.log(`Airlines: ${airlineCount.rows[0].count}`);
  console.log(`Specific flights: ${flightCount.rows[0].count}`);
  console.log(`Destinations: ${destCount.rows[0].count}`);

  console.log('\n✅ Database initialized successfully!');
  console.log(`Database file: ${dbPath}`);
}

init().catch((err) => {
  console.error('❌ Error initializing database:', err);
  process.exit(1);
});