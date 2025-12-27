import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  // Proxy /api/* requests to the API server at runtime
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const apiUrl = process.env.API_URL || 'http://api:3005';
    const url = new URL(request.nextUrl.pathname + request.nextUrl.search, apiUrl);
    
    return NextResponse.rewrite(url);
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
