'use client';

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import Eye from 'lucide-react/dist/esm/icons/eye';
import EyeOff from 'lucide-react/dist/esm/icons/eye-off';
import type { ConnectionFormProps } from './types';

/**
 * Connection form for a Navidrome (Subsonic-compatible) server. The same URL
 * and credentials are used for both the Subsonic API (library enumeration) and
 * Navidrome's native /api/ai/* endpoints (lyrics orchestration).
 */
export function NavidromeForm({ initialConfig, onConfigReady, onConfigInvalid }: ConnectionFormProps) {
  const [url, setUrl] = useState(initialConfig?.url ?? '');
  const [username, setUsername] = useState(initialConfig?.username ?? '');
  const [password, setPassword] = useState(initialConfig?.password ?? '');
  const [showPassword, setShowPassword] = useState(false);

  // Drive the wizard's Next button: emit a valid config when all required
  // fields are set, otherwise mark the form invalid.
  useEffect(() => {
    if (url && username && password) {
      onConfigReady({ url, username, password });
    } else {
      onConfigInvalid();
    }
  }, [url, username, password, onConfigReady, onConfigInvalid]);

  return (
    <>
      <div>
        <label className="text-sm font-medium">URL</label>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://localhost:4533"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Base URL of your Navidrome instance (no /rest or /api suffix).
        </p>
      </div>
      <div>
        <label className="text-sm font-medium">Username</label>
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Navidrome username"
        />
      </div>
      <div>
        <label className="text-sm font-medium">Password</label>
        <div className="relative">
          <Input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Navidrome password"
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Used for both Subsonic library reads and the AI lyrics pipeline.
        </p>
      </div>
    </>
  );
}
