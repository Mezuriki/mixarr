'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Badge, useToast, Select } from '@/components/ui';
import { PageHeader } from '@/components/layout/page-header';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { RefreshCw, Search, CheckCircle, AlertTriangle, Image, FileText, Music, ChevronUp, ChevronDown } from 'lucide-react';

interface LidarrArtist {
  id: number;
  name: string;
  foreignArtistId: string;
  path?: string;
  monitored: boolean;
  albumCount: number;
  trackCount: number;
  trackFileCount: number;
  sizeOnDisk: number;
  hasOverview: boolean;
  hasPoster: boolean;
  hasGenres: boolean;
  issues: string[];
  needsRefresh: boolean;
}

interface IssueStats {
  noAlbums: number;
  noPoster: number;
  noOverview: number;
  noGenres: number;
}

type SortField = 'name' | 'albumCount' | 'issues';
type SortDirection = 'asc' | 'desc';
type FilterType = 'all' | 'needs_refresh' | 'no_albums' | 'no_poster' | 'no_overview' | 'no_genres' | 'complete';

export default function LibraryPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { addToast } = useToast();
  const isAdmin = user?.role === 'admin';

  const [artists, setArtists] = useState<LidarrArtist[]>([]);
  const [issueStats, setIssueStats] = useState<IssueStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [sortField, setSortField] = useState<SortField>('issues');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [selectedArtists, setSelectedArtists] = useState<Set<number>>(new Set());
  const [refreshingArtists, setRefreshingArtists] = useState<Set<number>>(new Set());
  const [isBulkRefreshing, setIsBulkRefreshing] = useState(false);

  // Redirect non-admin users
  useEffect(() => {
    if (!authLoading && user && !isAdmin) {
      router.replace('/');
    }
  }, [user, isAdmin, authLoading, router]);

  // Fetch artists on mount
  useEffect(() => {
    if (isAdmin) {
      fetchArtists();
    }
  }, [isAdmin]);

  const fetchArtists = async () => {
    setIsLoading(true);
    const { data, error } = await api.get<{
      artists: LidarrArtist[];
      total: number;
      needingRefresh: number;
      issueStats: IssueStats;
    }>('/api/search/lidarr/artists');

    if (error) {
      addToast({ type: 'error', title: 'Failed to fetch library', message: error });
    } else if (data) {
      setArtists(data.artists);
      setIssueStats(data.issueStats);
    }
    setIsLoading(false);
  };

  const refreshArtist = async (artistId: number) => {
    setRefreshingArtists(prev => new Set(prev).add(artistId));
    
    const { error } = await api.post(`/api/search/lidarr/artists/${artistId}/refresh`);
    
    if (error) {
      addToast({ type: 'error', title: 'Failed to refresh artist' });
    } else {
      addToast({ type: 'success', title: 'Refresh triggered' });
    }
    
    setRefreshingArtists(prev => {
      const next = new Set(prev);
      next.delete(artistId);
      return next;
    });
  };

  const refreshSelected = async () => {
    if (selectedArtists.size === 0) return;
    
    setIsBulkRefreshing(true);
    const artistIds = Array.from(selectedArtists);
    let successCount = 0;
    
    for (const artistId of artistIds) {
      setRefreshingArtists(prev => new Set(prev).add(artistId));
      const { error } = await api.post(`/api/search/lidarr/artists/${artistId}/refresh`);
      if (!error) successCount++;
      
      setRefreshingArtists(prev => {
        const next = new Set(prev);
        next.delete(artistId);
        return next;
      });
      
      // Small delay between refreshes
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    addToast({ 
      type: 'success', 
      title: `Refreshed ${successCount} of ${artistIds.length} artists` 
    });
    
    setSelectedArtists(new Set());
    setIsBulkRefreshing(false);
    
    // Refresh the list after a delay
    setTimeout(fetchArtists, 3000);
  };

  const refreshByIssue = async (issueType: string) => {
    setIsBulkRefreshing(true);
    
    const { data, error } = await api.post<{ refreshed: number; message: string }>(
      '/api/search/lidarr/artists/refresh-by-issue',
      { issueType, limit: 50 }
    );
    
    if (error) {
      addToast({ type: 'error', title: 'Failed to refresh artists', message: error });
    } else if (data) {
      addToast({ type: 'success', title: 'Bulk refresh triggered', message: data.message });
      setTimeout(fetchArtists, 5000);
    }
    
    setIsBulkRefreshing(false);
  };

  // Filter and sort artists
  const filteredArtists = useMemo(() => {
    let result = [...artists];
    
    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(a => a.name.toLowerCase().includes(query));
    }
    
    // Apply issue filter
    switch (filter) {
      case 'needs_refresh':
        result = result.filter(a => a.needsRefresh);
        break;
      case 'no_albums':
        result = result.filter(a => a.issues.includes('no_albums'));
        break;
      case 'no_poster':
        result = result.filter(a => a.issues.includes('no_poster'));
        break;
      case 'no_overview':
        result = result.filter(a => a.issues.includes('no_overview'));
        break;
      case 'no_genres':
        result = result.filter(a => a.issues.includes('no_genres'));
        break;
      case 'complete':
        result = result.filter(a => !a.needsRefresh);
        break;
    }
    
    // Apply sorting
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'albumCount':
          comparison = a.albumCount - b.albumCount;
          break;
        case 'issues':
          comparison = a.issues.length - b.issues.length;
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    
    return result;
  }, [artists, searchQuery, filter, sortField, sortDirection]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const toggleSelectAll = () => {
    if (selectedArtists.size === filteredArtists.length) {
      setSelectedArtists(new Set());
    } else {
      setSelectedArtists(new Set(filteredArtists.map(a => a.id)));
    }
  };

  const toggleSelectArtist = (artistId: number) => {
    setSelectedArtists(prev => {
      const next = new Set(prev);
      if (next.has(artistId)) {
        next.delete(artistId);
      } else {
        next.add(artistId);
      }
      return next;
    });
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? 
      <ChevronUp className="h-4 w-4 inline ml-1" /> : 
      <ChevronDown className="h-4 w-4 inline ml-1" />;
  };

  // Don't render for non-admin users
  if (authLoading || !user || !isAdmin) {
    return null;
  }

  return (
    <>
      <PageHeader
        title="Lidarr Library"
        description="View and manage missing metadata in your Lidarr library"
      >
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchArtists} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </PageHeader>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-5 mb-6">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{artists.length}</div>
            <p className="text-xs text-muted-foreground">Total Artists</p>
          </CardContent>
        </Card>
        <Card className={issueStats?.noAlbums ? 'border-yellow-500/50' : ''}>
          <CardContent className="pt-4">
            <div className={`text-2xl font-bold ${issueStats?.noAlbums ? 'text-yellow-500' : 'text-green-500'}`}>
              {issueStats?.noAlbums || 0}
            </div>
            <p className="text-xs text-muted-foreground">No Albums</p>
          </CardContent>
        </Card>
        <Card className={issueStats?.noPoster ? 'border-yellow-500/50' : ''}>
          <CardContent className="pt-4">
            <div className={`text-2xl font-bold ${issueStats?.noPoster ? 'text-yellow-500' : 'text-green-500'}`}>
              {issueStats?.noPoster || 0}
            </div>
            <p className="text-xs text-muted-foreground">No Poster</p>
          </CardContent>
        </Card>
        <Card className={issueStats?.noOverview ? 'border-yellow-500/50' : ''}>
          <CardContent className="pt-4">
            <div className={`text-2xl font-bold ${issueStats?.noOverview ? 'text-yellow-500' : 'text-green-500'}`}>
              {issueStats?.noOverview || 0}
            </div>
            <p className="text-xs text-muted-foreground">No Bio</p>
          </CardContent>
        </Card>
        <Card className={issueStats?.noGenres ? 'border-yellow-500/50' : ''}>
          <CardContent className="pt-4">
            <div className={`text-2xl font-bold ${issueStats?.noGenres ? 'text-yellow-500' : 'text-green-500'}`}>
              {issueStats?.noGenres || 0}
            </div>
            <p className="text-xs text-muted-foreground">No Genres</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Actions */}
      <Card className="mb-6">
        <CardContent className="pt-4">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search artists..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            
            {/* Filter */}
            <div className="w-full md:w-48">
              <Select
                value={filter}
                onChange={(e) => setFilter(e.target.value as FilterType)}
                options={[
                  { value: 'all', label: 'All Artists' },
                  { value: 'needs_refresh', label: 'Needs Refresh' },
                  { value: 'no_albums', label: 'No Albums' },
                  { value: 'no_poster', label: 'No Poster' },
                  { value: 'no_overview', label: 'No Bio' },
                  { value: 'no_genres', label: 'No Genres' },
                  { value: 'complete', label: 'Complete' },
                ]}
              />
            </div>
            
            {/* Bulk Actions */}
            <div className="flex gap-2">
              {selectedArtists.size > 0 && (
                <Button
                  onClick={refreshSelected}
                  disabled={isBulkRefreshing}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${isBulkRefreshing ? 'animate-spin' : ''}`} />
                  Refresh Selected ({selectedArtists.size})
                </Button>
              )}
              
              {filter !== 'all' && filter !== 'complete' && filteredArtists.length > 0 && (
                <Button
                  variant="outline"
                  onClick={() => refreshByIssue(filter === 'needs_refresh' ? 'any' : filter)}
                  disabled={isBulkRefreshing}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${isBulkRefreshing ? 'animate-spin' : ''}`} />
                  Refresh All Filtered (up to 50)
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Artists Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Artists ({filteredArtists.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredArtists.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {artists.length === 0 ? 'No artists found in Lidarr' : 'No artists match your filters'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2 w-10">
                      <input
                        type="checkbox"
                        checked={selectedArtists.size === filteredArtists.length && filteredArtists.length > 0}
                        onChange={toggleSelectAll}
                        className="rounded"
                      />
                    </th>
                    <th 
                      className="text-left py-3 px-2 cursor-pointer hover:bg-muted/50"
                      onClick={() => toggleSort('name')}
                    >
                      Artist <SortIcon field="name" />
                    </th>
                    <th 
                      className="text-center py-3 px-2 cursor-pointer hover:bg-muted/50 w-24"
                      onClick={() => toggleSort('albumCount')}
                    >
                      Albums <SortIcon field="albumCount" />
                    </th>
                    <th className="text-center py-3 px-2 w-32">Status</th>
                    <th 
                      className="text-center py-3 px-2 cursor-pointer hover:bg-muted/50 w-24"
                      onClick={() => toggleSort('issues')}
                    >
                      Issues <SortIcon field="issues" />
                    </th>
                    <th className="text-right py-3 px-2 w-24">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredArtists.map((artist) => (
                    <tr key={artist.id} className="border-b hover:bg-muted/50">
                      <td className="py-3 px-2">
                        <input
                          type="checkbox"
                          checked={selectedArtists.has(artist.id)}
                          onChange={() => toggleSelectArtist(artist.id)}
                          className="rounded"
                        />
                      </td>
                      <td className="py-3 px-2">
                        <div className="font-medium">{artist.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {artist.trackFileCount} / {artist.trackCount} tracks
                        </div>
                      </td>
                      <td className="text-center py-3 px-2">
                        <span className={artist.albumCount === 0 ? 'text-yellow-500 font-medium' : ''}>
                          {artist.albumCount}
                        </span>
                      </td>
                      <td className="py-3 px-2">
                        <div className="flex items-center justify-center gap-1">
                          <span title={artist.hasPoster ? 'Has poster' : 'No poster'}>
                            <Image className={`h-4 w-4 ${artist.hasPoster ? 'text-green-500' : 'text-yellow-500'}`} />
                          </span>
                          <span title={artist.hasOverview ? 'Has bio' : 'No bio'}>
                            <FileText className={`h-4 w-4 ${artist.hasOverview ? 'text-green-500' : 'text-yellow-500'}`} />
                          </span>
                          <span title={artist.hasGenres ? 'Has genres' : 'No genres'}>
                            <Music className={`h-4 w-4 ${artist.hasGenres ? 'text-green-500' : 'text-yellow-500'}`} />
                          </span>
                        </div>
                      </td>
                      <td className="text-center py-3 px-2">
                        {artist.issues.length === 0 ? (
                          <Badge variant="default" className="bg-green-600">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            OK
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-yellow-600/20 text-yellow-500">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            {artist.issues.length}
                          </Badge>
                        )}
                      </td>
                      <td className="text-right py-3 px-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => refreshArtist(artist.id)}
                          disabled={refreshingArtists.has(artist.id)}
                        >
                          <RefreshCw className={`h-4 w-4 ${refreshingArtists.has(artist.id) ? 'animate-spin' : ''}`} />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
