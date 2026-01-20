'use client';

import { useState, useEffect } from 'react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import Brain from 'lucide-react/dist/esm/icons/brain';
import Eye from 'lucide-react/dist/esm/icons/eye';
import EyeOff from 'lucide-react/dist/esm/icons/eye-off';
import Save from 'lucide-react/dist/esm/icons/save';

interface AISettingsData {
  openaiEnabled: boolean;
  openaiConfigured: boolean;
  openaiApiKey?: string;
  anthropicEnabled: boolean;
  anthropicConfigured: boolean;
  anthropicApiKey?: string;
}

export function AISettings() {
  const [settings, setSettings] = useState<AISettingsData>({
    openaiEnabled: false,
    openaiConfigured: false,
    anthropicEnabled: false,
    anthropicConfigured: false,
  });
  const [openaiKey, setOpenaiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const { addToast } = useToast();

  const fetchSettings = async () => {
    setIsLoading(true);
    try {
      const { data } = await api.get<{ settings: AISettingsData }>('/api/ai/settings');
      if (data) {
        setSettings(data.settings);
        if (data.settings.openaiApiKey) {
          setOpenaiKey(data.settings.openaiApiKey);
        }
        if (data.settings.anthropicApiKey) {
          setAnthropicKey(data.settings.anthropicApiKey);
        }
      }
    } catch {
      addToast({ type: 'error', title: 'Failed to load AI settings' });
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const { error } = await api.put('/api/ai/settings', {
        openaiEnabled: settings.openaiEnabled,
        openaiApiKey: openaiKey || undefined,
        anthropicEnabled: settings.anthropicEnabled,
        anthropicApiKey: anthropicKey || undefined,
      });

      if (error) {
        addToast({ type: 'error', title: 'Failed to save AI settings', message: error });
      } else {
        addToast({ type: 'success', title: 'AI settings saved' });
        fetchSettings();
      }
    } catch {
      addToast({ type: 'error', title: 'Failed to save AI settings' });
    }
    setIsSaving(false);
  };

  const handleToggle = (key: 'openaiEnabled' | 'anthropicEnabled') => {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }));
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <Brain className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-lg">AI Integration</CardTitle>
              <CardDescription>Loading...</CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <Brain className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-lg">AI Integration</CardTitle>
              <CardDescription>
                Configure AI-powered artist recommendations using OpenAI or Anthropic
              </CardDescription>
            </div>
          </div>
          <Button onClick={handleSave} disabled={isSaving} size="sm">
            <Save className="h-4 w-4 mr-2" /> {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* OpenAI Section */}
        <div className="rounded-lg border p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">OpenAI (GPT-4)</h3>
              <p className="text-sm text-muted-foreground">
                Use OpenAI&apos;s GPT models for recommendations
              </p>
            </div>
            <button
              onClick={() => handleToggle('openaiEnabled')}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings.openaiEnabled ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.openaiEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {settings.openaiEnabled && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">API Key</label>
                <div className="relative">
                  <Input
                    type={showOpenaiKey ? 'text' : 'password'}
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    placeholder={settings.openaiConfigured ? '••••••••••••••••' : 'sk-...'}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showOpenaiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {settings.openaiConfigured && (
                  <p className="text-xs text-green-600">✓ API key configured</p>
                )}
              </div>
            </>
          )}
        </div>

        {/* Anthropic Section */}
        <div className="rounded-lg border p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">Anthropic (Claude)</h3>
              <p className="text-sm text-muted-foreground">
                Use Anthropic&apos;s Claude models for recommendations
              </p>
            </div>
            <button
              onClick={() => handleToggle('anthropicEnabled')}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings.anthropicEnabled ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.anthropicEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {settings.anthropicEnabled && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">API Key</label>
                <div className="relative">
                  <Input
                    type={showAnthropicKey ? 'text' : 'password'}
                    value={anthropicKey}
                    onChange={(e) => setAnthropicKey(e.target.value)}
                    placeholder={settings.anthropicConfigured ? '••••••••••••••••' : 'sk-ant-...'}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAnthropicKey(!showAnthropicKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showAnthropicKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {settings.anthropicConfigured && (
                  <p className="text-xs text-green-600">✓ API key configured</p>
                )}
              </div>
            </>
          )}
        </div>

        {/* Info */}
        <div className="rounded-lg bg-blue-50 dark:bg-blue-950/50 p-4 text-sm">
          <p className="font-medium text-blue-900 dark:text-blue-100">About AI Recommendations</p>
          <p className="mt-1 text-blue-800 dark:text-blue-200">
            AI recommendations analyze your library and listening patterns to suggest new artists.
            Configure AI recommendation strategy per-subscription when creating an AI Recommendations subscription.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
