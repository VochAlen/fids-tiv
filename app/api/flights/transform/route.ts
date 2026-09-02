// app/api/flights/transform/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { transformWithDeepSeek, manualTransform, FlightData } from '@/lib/flight-transformer';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { apiUrl, jsonData, openRouterApiKey, useAI = true } = body;

    if (!apiUrl && !jsonData) {
      return NextResponse.json(
        { error: 'Either apiUrl or jsonData must be provided' },
        { status: 400 }
      );
    }

    if (useAI && !openRouterApiKey) {
      return NextResponse.json(
        { error: 'OpenRouter API key is required for AI transformation' },
        { status: 400 }
      );
    }

    let rawData: any;

    // Fetch data from provided API URL or use direct JSON data
    if (apiUrl) {
      try {
        const response = await fetch(apiUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
          }
        });

        if (!response.ok) {
          throw new Error(`API responded with status ${response.status}`);
        }

        rawData = await response.json();
      } catch (fetchError) {
        return NextResponse.json(
          { error: `Failed to fetch from API: ${fetchError}` },
          { status: 400 }
        );
      }
    } else {
      rawData = jsonData;
    }

    console.log(`Processing ${Array.isArray(rawData) ? rawData.length : 'unknown'} flight records`);

    let transformedData: FlightData;

    // Use AI transformation or fallback to manual
    if (useAI && openRouterApiKey) {
      try {
        transformedData = await transformWithDeepSeek(rawData, openRouterApiKey);
        console.log('AI transformation completed successfully');
      } catch (aiError) {
        console.warn('AI transformation failed, using manual fallback:', aiError);
        transformedData = manualTransform(rawData);
      }
    } else {
      transformedData = manualTransform(rawData);
    }

    // Validate that we have proper flight type separation
    const departureCount = transformedData.departures.length;
    const arrivalCount = transformedData.arrivals.length;
    
    console.log(`Transformation complete: ${departureCount} departures, ${arrivalCount} arrivals`);

    return NextResponse.json(transformedData, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120'
      }
    });

  } catch (error) {
    console.error('Transformation endpoint error:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to transform flight data',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}