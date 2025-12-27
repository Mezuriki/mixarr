/**
 * Data Migration Utility
 * 
 * Migrates data from Flask v1 MySQL schema to v2 Prisma schema.
 * Run with: npx tsx scripts/migrate-data.ts
 */

import { PrismaClient } from '@prisma/client';
import mysql from 'mysql2/promise';

const prisma = new PrismaClient();

interface V1Connection {
  id: number;
  lidarr_url: string | null;
  lidarr_api_key: string | null;
  spotify_client_id: string | null;
  spotify_client_secret: string | null;
  spotify_access_token: string | null;
  spotify_refresh_token: string | null;
  lastfm_api_key: string | null;
  created_at: Date;
  updated_at: Date;
}

interface V1Subscription {
  id: number;
  name: string;
  source: string;
  source_type: string;
  source_id: string | null;
  schedule: string | null;
  is_active: boolean;
  last_run: Date | null;
  next_run: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface V1ImportSource {
  id: number;
  type: string;
  name: string;
  spotify_id: string | null;
  schedule: string | null;
  result_handling: string;
  is_active: boolean;
  last_run: Date | null;
  created_at: Date;
  updated_at: Date;
}

async function migrateData() {
  const v1DbUrl = process.env.V1_DATABASE_URL;
  if (!v1DbUrl) {
    console.error('V1_DATABASE_URL environment variable required');
    process.exit(1);
  }

  console.log('Connecting to v1 database...');
  const v1Connection = await mysql.createConnection(v1DbUrl);

  try {
    // Check if admin user exists (created during setup)
    const adminUser = await prisma.user.findFirst({
      where: { role: 'admin' },
    });

    if (!adminUser) {
      console.error('No admin user found. Run setup wizard first.');
      process.exit(1);
    }

    console.log(`Migrating data for user: ${adminUser.username}`);

    // Migrate connections
    console.log('Migrating connections...');
    const [connectionRows] = await v1Connection.execute('SELECT * FROM connection LIMIT 1');
    const v1Connections = connectionRows as V1Connection[];

    if (v1Connections.length > 0) {
      const conn = v1Connections[0];

      // Lidarr connection
      if (conn.lidarr_url && conn.lidarr_api_key) {
        await prisma.connection.upsert({
          where: {
            userId_type_name: {
              userId: adminUser.id,
              type: 'lidarr',
              name: 'Default Lidarr',
            },
          },
          create: {
            userId: adminUser.id,
            type: 'lidarr',
            name: 'Default Lidarr',
            config: {
              url: conn.lidarr_url,
              apiKey: conn.lidarr_api_key,
            },
            isActive: true,
          },
          update: {
            config: {
              url: conn.lidarr_url,
              apiKey: conn.lidarr_api_key,
            },
          },
        });
        console.log('  - Migrated Lidarr connection');
      }

      // Spotify connection
      if (conn.spotify_client_id && conn.spotify_client_secret) {
        await prisma.connection.upsert({
          where: {
            userId_type_name: {
              userId: adminUser.id,
              type: 'spotify',
              name: 'Default Spotify',
            },
          },
          create: {
            userId: adminUser.id,
            type: 'spotify',
            name: 'Default Spotify',
            config: {
              clientId: conn.spotify_client_id,
              clientSecret: conn.spotify_client_secret,
              accessToken: conn.spotify_access_token,
              refreshToken: conn.spotify_refresh_token,
            },
            isActive: true,
          },
          update: {
            config: {
              clientId: conn.spotify_client_id,
              clientSecret: conn.spotify_client_secret,
              accessToken: conn.spotify_access_token,
              refreshToken: conn.spotify_refresh_token,
            },
          },
        });
        console.log('  - Migrated Spotify connection');
      }

      // Last.fm connection
      if (conn.lastfm_api_key) {
        await prisma.connection.upsert({
          where: {
            userId_type_name: {
              userId: adminUser.id,
              type: 'lastfm',
              name: 'Default Last.fm',
            },
          },
          create: {
            userId: adminUser.id,
            type: 'lastfm',
            name: 'Default Last.fm',
            config: {
              apiKey: conn.lastfm_api_key,
            },
            isActive: true,
          },
          update: {
            config: {
              apiKey: conn.lastfm_api_key,
            },
          },
        });
        console.log('  - Migrated Last.fm connection');
      }
    }

    // Migrate subscriptions
    console.log('Migrating subscriptions...');
    const [subRows] = await v1Connection.execute('SELECT * FROM subscription');
    const v1Subs = subRows as V1Subscription[];

    for (const sub of v1Subs) {
      const typeMap: Record<string, string> = {
        'lastfm': sub.source_type === 'chart' ? 'lastfm_chart' :
                  sub.source_type === 'tag' ? 'lastfm_tag' :
                  sub.source_type === 'geo' ? 'lastfm_geo' : 'lastfm_chart',
        'spotify': sub.source_type === 'playlist' ? 'spotify_playlist' : 'spotify_new_releases',
      };

      await prisma.subscription.create({
        data: {
          userId: adminUser.id,
          name: sub.name,
          type: typeMap[sub.source] as any || 'lastfm_chart',
          config: {
            sourceId: sub.source_id,
            sourceType: sub.source_type,
          },
          schedule: sub.schedule,
          isActive: sub.is_active,
          lastRun: sub.last_run,
          nextRun: sub.next_run,
        },
      });
      console.log(`  - Migrated subscription: ${sub.name}`);
    }

    // Migrate import sources
    console.log('Migrating import sources...');
    const [importRows] = await v1Connection.execute('SELECT * FROM import_source');
    const v1Imports = importRows as V1ImportSource[];

    for (const imp of v1Imports) {
      const typeMap: Record<string, string> = {
        'liked_songs': 'liked_songs',
        'saved_albums': 'saved_albums',
        'followed_artists': 'followed_artists',
        'playlist': 'playlist',
      };

      const handlingMap: Record<string, string> = {
        'preview': 'preview',
        'queue': 'queue',
        'auto': 'auto',
      };

      await prisma.importSource.create({
        data: {
          userId: adminUser.id,
          type: typeMap[imp.type] as any || 'liked_songs',
          name: imp.name,
          externalId: imp.spotify_id,
          schedule: imp.schedule,
          resultHandling: handlingMap[imp.result_handling] as any || 'preview',
          isActive: imp.is_active,
          lastRun: imp.last_run,
        },
      });
      console.log(`  - Migrated import source: ${imp.name}`);
    }

    console.log('Migration complete!');

  } finally {
    await v1Connection.end();
    await prisma.$disconnect();
  }
}

migrateData().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
