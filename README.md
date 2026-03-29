# Flight Information Display System (FIDS)

A Next.js 15.2.4 application for displaying real-time flight information on Android Smart TV browsers (Android 7+).

## Features

- **Arrivals Display** - Table view of arriving flights
- **Departures Display** - Table view of departing flights
- **Combined Display** - Auto-switches between arrivals and departures every 25 seconds
- **Gate Display** (Landscape) - Shows flight information for a specific gate
- **Check-In Display** (Portrait) - Shows flight information for check-in desks with rotating advertisements
- **Baggage Claim Display** - Shows baggage belt information for arriving flights

## Data Source

Fetches flight data every 60 seconds from:
```
https://montenegroairports.com/aerodromixs/cache-flights.php?airport=tv
```

## Pages

- `/` - Home page with navigation links
- `/arrivals` - Arrivals board
- `/departures` - Departures board
- `/combined` - Combined arrivals/departures with auto-switch
- `/gate/[gateNumber]` - Gate display (e.g., `/gate/1`, `/gate/2`)
- `/checkin/[deskNumber]` - Check-in display (e.g., `/checkin/1`, `/checkin/2`)
- `/baggage/[beltNumber]` - Baggage claim display (e.g., `/baggage/1`)

## Check-In Display Behavior

- Shows flight details when `StatusEN` is "Processing"
- Shows only the desk number on blank screen when flight is not processing
- Bottom third displays rotating advertisements (15-second intervals)

## Technology Stack

- Next.js 15.2.4 (App Router)
- React 19
- TypeScript 5.2.2
- Tailwind CSS 3.3.3
- Optimized for Vercel deployment

## Development

```bash
npm install
npm run dev
```

## Production Build

```bash
npm run build
npm run start
```

## Deployment

Optimized for Vercel deployment. Simply push to your connected repository.

## Browser Compatibility

Tested and optimized for Android Smart TV browsers from Android 7 to latest versions.
