'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/layout/page-header';
import { api } from '@/lib/api';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import CheckCircle from 'lucide-react/dist/esm/icons/check-circle';
import Download from 'lucide-react/dist/esm/icons/download';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Music2 from 'lucide-react/dist/esm/icons/music-2';
import Radio from 'lucide-react/dist/esm/icons/radio';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles';
import Users from 'lucide-react/dist/esm/icons/users';
import XCircle from 'lucide-react/dist/esm/icons/x-circle';

interface Artist {
  id?: string;
  name: string;
  images?: Array<{ url: string }>;
  genres?: string[];
  playcount?: string;
  listeners?: string;
  mbid?: string;
  url?: string;
}

interface AIRecommendation {
  name: string;
  source: string;
  strategy: string;
}

interface PreviewData {
  connection: { id: number; name: string };
  artists: Artist[];
  similarArtists?: Artist[];
  aiRecommendations: AIRecommendation[];
  total: number;
  filtered: number;
}

export default function PreviewPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { addToast } = useToast();

  const connectionId = searchParams.get('connectionId');
  const connectionType = searchParams.get('type') as 'spotify' | 'lastfm' | null;

  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedArtists, setSelectedArtists] = useState<Set<string>>(new Set());
  const [isImporting, setIsImporting] = useState(false);
  const [importResults, setImportResults] = useState<Array<{ name: string; success: boolean; message: string }>>([]);

  const fetchPreview = useCallback(async (includeAI = true, includeSimilar = true) => {
    if (!connectionId || !connectionType) return;

    setIsLoading(true);
    const params = new URLSearchParams();
    if (includeAI) params.set('ai', 'true');
    if (includeSimilar && connectionType === 'lastfm') params.set('similar', 'true');

    const { data, error } = await api.get<PreviewData>(
      `/api/imports/preview/${connectionType}/${connectionId}?${params}`
    );

    if (data) {
      setPreviewData(data);
      // Auto-select all artists by default
      setSelectedArtists(new Set(data.artists.map(a => a.name)));
    }
    if (error) {
      addToast({ type: 'error', title: 'Failed to load preview', message: error });
    }
    setIsLoading(false);
  }, [connectionId, connectionType, addToast]);

  useEffect(() => {
    fetchPreview();
  }, [fetchPreview]);

  const toggleArtist = (name: string) => {
    const newSelected = new Set(selectedArtists);
    if (newSelected.has(name)) {
      newSelected.delete(name);
    } else {
      newSelected.add(name);
    }
    setSelectedArtists(newSelected);
  };

  const selectAll = () => {
    if (!previewData) return;
    const allNames = [
      ...previewData.artists.map(a => a.name),
      ...(previewData.similarArtists?.map(a => a.name) || []),
      ...previewData.aiRecommendations.map(a => a.name),
    ];
    setSelectedArtists(new Set(allNames));
  };

  const selectNone = () => {
    setSelectedArtists(new Set());
  };

  const handleImport = async () => {
    if (selectedArtists.size === 0) {
      addToast({ type: 'error', title: 'No artists selected' });
      return;
    }

    setIsImporting(true);
    const { data, error } = await api.post<{
      success: boolean;
      message: string;
      results: Array<{ name: string; success: boolean; message: string }>;
    }>('/api/imports/preview/import', {
      artistNames: Array.from(selectedArtists),
    });

    if (data) {
      setImportResults(data.results);
      addToast({
        type: data.success ? 'success' : 'error',
        title: data.message,
      });
      
      // Remove successfully imported artists from preview
      if (previewData) {
        const successNames = new Set(data.results.filter(r => r.success).map(r => r.name.toLowerCase()));
        setPreviewData({
          ...previewData,
          artists: previewData.artists.filter(a => !successNames.has(a.name.toLowerCase())),
          similarArtists: previewData.similarArtists?.filter(a => !successNames.has(a.name.toLowerCase())),
          aiRecommendations: previewData.aiRecommendations.filter(a => !successNames.has(a.name.toLowerCase())),
        });
        // Update selection
        const newSelected = new Set(selectedArtists);
        successNames.forEach(name => {
          // Find and remove the actual case-sensitive name
          Array.from(newSelected).forEach(n => {
            if (n.toLowerCase() === name) newSelected.delete(n);
          });
        });
        setSelectedArtists(newSelected);
      }
    }
    if (error) {
      addToast({ type: 'error', title: 'Import failed', message: error });
    }
    setIsImporting(false);
  };

  if (!connectionId || !connectionType) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground mb-4">No connection specified</p>
        <Button onClick={() => router.push('/connections')}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Connections
        </Button>
      </div>
    );
  }

  const TypeIcon = connectionType === 'spotify' ? Music2 : Radio;

  return (
    <>
      <PageHeader
        title={`Preview ${connectionType === 'spotify' ? 'Spotify' : 'Last.fm'} Artists`}
        description={previewData ? `${previewData.total} artists not in your Lidarr library (${previewData.filtered} filtered)` : 'Loading...'}
      >
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push('/connections')}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back
          </Button>
          <Button variant="outline" onClick={() => fetchPreview()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button
            onClick={handleImport}
            disabled={isImporting || selectedArtists.size === 0}
          >
            <Download className={`h-4 w-4 mr-2 ${isImporting ? 'animate-pulse' : ''}`} />
            Import {selectedArtists.size} Artist{selectedArtists.size !== 1 ? 's' : ''}
          </Button>
        </div>
      </PageHeader>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : previewData ? (
        <div className="space-y-6">
          {/* Selection Controls */}
          <div className="flex items-center gap-4">
            <Button variant="outline" size="sm" onClick={selectAll}>
              Select All
            </Button>
            <Button variant="outline" size="sm" onClick={selectNone}>
              Select None
            </Button>
            <span className="text-sm text-muted-foreground">
              {selectedArtists.size} selected
            </span>
          </div>

          {/* Import Results */}
          {importResults.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Import Results</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {importResults.map((result, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      {result.success ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                      <span className={result.success ? 'text-green-600' : 'text-red-600'}>
                        {result.name}: {result.message}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Main Artists */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <TypeIcon className="h-5 w-5" />
                <CardTitle>
                  {connectionType === 'spotify' ? 'Your Spotify Artists' : 'Top Artists'}
                </CardTitle>
              </div>
              <CardDescription>
                {previewData.artists.length} artists from your {connectionType === 'spotify' ? 'followed artists and liked songs' : 'charts'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {previewData.artists.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">
                  All artists are already in your Lidarr library!
                </p>
              ) : (
                <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                  {previewData.artists.map((artist) => (
                    <div
                      key={artist.id || artist.name}
                      onClick={() => toggleArtist(artist.name)}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedArtists.has(artist.name)
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      {artist.images?.[0]?.url ? (
                        <img
                          src={artist.images[0].url}
                          alt={artist.name}
                          className="h-10 w-10 rounded-full object-cover"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                          <Music2 className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{artist.name}</p>
                        {artist.listeners && (
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {parseInt(artist.listeners).toLocaleString()} listeners
                          </p>
                        )}
                      </div>
                      {selectedArtists.has(artist.name) && (
                        <CheckCircle className="h-5 w-5 text-primary shrink-0" />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Similar Artists (Last.fm only) */}
          {previewData.similarArtists && previewData.similarArtists.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  <CardTitle>Similar Artists</CardTitle>
                </div>
                <CardDescription>
                  Artists similar to your top artist
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                  {previewData.similarArtists.map((artist) => (
                    <div
                      key={artist.name}
                      onClick={() => toggleArtist(artist.name)}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedArtists.has(artist.name)
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                        <Music2 className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{artist.name}</p>
                      </div>
                      {selectedArtists.has(artist.name) && (
                        <CheckCircle className="h-5 w-5 text-primary shrink-0" />
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* AI Recommendations */}
          {previewData.aiRecommendations.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5" />
                  <CardTitle>AI Recommendations</CardTitle>
                  <Badge variant="secondary">AI</Badge>
                </div>
                <CardDescription>
                  Suggested artists based on your taste
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                  {previewData.aiRecommendations.map((rec) => (
                    <div
                      key={rec.name}
                      onClick={() => toggleArtist(rec.name)}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedArtists.has(rec.name)
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      <div className="h-10 w-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                        <Sparkles className="h-5 w-5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{rec.name}</p>
                        <p className="text-xs text-muted-foreground">
                          via {rec.source} • {rec.strategy}
                        </p>
                      </div>
                      {selectedArtists.has(rec.name) && (
                        <CheckCircle className="h-5 w-5 text-primary shrink-0" />
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          Failed to load preview data
        </div>
      )}
    </>
  );
}
