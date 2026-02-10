import { prisma } from '../../src/lib/db';
import { isSlskdRateLimitingEnabled } from '../../src/lib/settings';

describe('isSlskdRateLimitingEnabled', () => {
  afterEach(async () => {
    // Reset to default - ensure the record exists first
    await prisma.$executeRaw`
      INSERT INTO global_settings (\`key\`, value, created_at, updated_at)
      VALUES ('slskd_rate_limiting_enabled', CAST('false' AS JSON), NOW(), NOW())
      ON DUPLICATE KEY UPDATE value = CAST('false' AS JSON), updated_at = NOW()
    `;
  });
  
  test('returns false when setting is false', async () => {
    const result = await isSlskdRateLimitingEnabled();
    expect(result).toBe(false);
  });
  
  test('returns true when setting is true', async () => {
    await prisma.$executeRaw`
      UPDATE global_settings SET value = CAST('true' AS JSON) WHERE \`key\` = 'slskd_rate_limiting_enabled'
    `;
    
    const result = await isSlskdRateLimitingEnabled();
    expect(result).toBe(true);
  });
  
  test('returns false when setting missing', async () => {
    await prisma.$executeRaw`
      DELETE FROM global_settings WHERE \`key\` = 'slskd_rate_limiting_enabled'
    `;
    
    const result = await isSlskdRateLimitingEnabled();
    expect(result).toBe(false);
  });
});
