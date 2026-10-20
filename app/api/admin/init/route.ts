import { NextResponse } from 'next/server';
import { initializeDatabase } from '@/lib/db';
import { requireAdmin } from '@/lib/admin-auth';

export async function POST() {
  { const { error: authError } = await requireAdmin(); if (authError) return authError; }
  try {
    await initializeDatabase();
    return NextResponse.json({ 
      success: true, 
      message: 'Baza podataka uspješno inicijalizovana' 
    });
  } catch (error) {
    console.error('Error initializing database:', error);
    return NextResponse.json(
      { success: false, error: 'Greška pri inicijalizaciji baze' },
      { status: 500 }
    );
  }
}