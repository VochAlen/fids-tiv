
'use client';

import type React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { 
  Trash2, 
  RefreshCw, 
  Database, 
  Clock, 
  Calendar, 
  Plane, 
  Download, 
  AlertTriangle,
  CheckCircle,
  XCircle,
  Info,
  Shield,
  HardDrive,
  History,
  ArrowLeft
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { BackupData, BackupStats } from '@/lib/backup/flight-backup-service';

// Mock interfejs za backup stats
interface DashboardStats {
  totalBackups: number;
  todayBackups: number;
  latestBackupTime: string;
  systemStatus: 'healthy' | 'degraded' | 'empty';
  totalFlights: number;
  totalDepartures: number;
  totalArrivals: number;
}

// Mock interfejs za backup
interface Backup {
  id: string;
  timestamp: string;
  date: string;
  metadata: {
    totalFlights: number;
    departures: number;
    arrivals: number;
  };
}

export default function DashboardPage(): React.JSX.Element {
  const router = useRouter();
  const [backups, setBackups] = useState<Backup[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [deletingBackupId, setDeletingBackupId] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const [notification, setNotification] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  // Fetch backup data
  const fetchBackupData = useCallback(async () => {
    try {
      setLoading(true);
      
      // Fetch stats
      const statsResponse = await fetch('/api/flights/backup/stats');
      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        if (statsData.success) {
          setStats(statsData.stats);
        }
      }
      
      // Fetch all backups
      const backupsResponse = await fetch('/api/flights/backup/list');
      if (backupsResponse.ok) {
        const backupsData = await backupsResponse.json();
        if (backupsData.success) {
          setBackups(backupsData.backups);
        }
      }
    } catch (error) {
      console.error('Error fetching backup data:', error);
      showNotification('error', 'Failed to fetch backup data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchBackupData();
  }, [fetchBackupData, refreshCount]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setRefreshCount(prev => prev + 1);
    }, 30000);
    
    return () => clearInterval(interval);
  }, []);

  const showNotification = (type: 'success' | 'error' | 'info', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  };

  const handleDeleteBackup = async (backupId: string) => {
    if (!confirm('Are you sure you want to delete this backup? This action cannot be undone.')) {
      return;
    }

    setDeletingBackupId(backupId);
    
    try {
      const response = await fetch('/api/flights/backup/manage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'delete',
          backupId
        })
      });

      const data = await response.json();
      
      if (data.success) {
        showNotification('success', `Backup deleted successfully`);
        // Refresh data
        setRefreshCount(prev => prev + 1);
      } else {
        showNotification('error', data.message || 'Failed to delete backup');
      }
    } catch (error) {
      console.error('Error deleting backup:', error);
      showNotification('error', 'Failed to delete backup');
    } finally {
      setDeletingBackupId(null);
    }
  };

  const handleDeleteAllBackups = async () => {
    if (!confirm('Are you sure you want to delete ALL backups? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch('/api/flights/backup/manage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'deleteAll'
        })
      });

      const data = await response.json();
      
      if (data.success) {
        showNotification('success', `All backups deleted (${data.deletedCount} backups)`);
        // Refresh data
        setRefreshCount(prev => prev + 1);
      } else {
        showNotification('error', data.message || 'Failed to delete backups');
      }
    } catch (error) {
      console.error('Error deleting all backups:', error);
      showNotification('error', 'Failed to delete backups');
    }
  };

  const handleCreateManualBackup = async () => {
    try {
      const response = await fetch('/api/flights/backup/manage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'create'
        })
      });

      const data = await response.json();
      
      if (data.success) {
        showNotification('success', 'Manual backup created successfully');
        // Refresh data
        setRefreshCount(prev => prev + 1);
      } else {
        showNotification('error', data.message || 'Failed to create backup');
      }
    } catch (error) {
      console.error('Error creating manual backup:', error);
      showNotification('error', 'Failed to create backup');
    }
  };

  const formatDateTime = (timestamp: string): string => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const formatTimeAgo = (timestamp: string): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  };

  const getSystemStatusColor = (status: DashboardStats['systemStatus']): string => {
    switch (status) {
      case 'healthy': return 'bg-green-500';
      case 'degraded': return 'bg-yellow-500';
      case 'empty': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getSystemStatusText = (status: DashboardStats['systemStatus']): string => {
    switch (status) {
      case 'healthy': return 'System Healthy';
      case 'degraded': return 'System Degraded';
      case 'empty': return 'No Backups';
      default: return 'Unknown';
    }
  };

  if (loading && backups.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center h-96">
            <div className="text-center">
              <div className="w-16 h-16 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-lg text-cyan-200">Loading backup dashboard...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white p-4 md:p-8">
      {/* Notification */}
      {notification && (
        <div className={`fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg max-w-md animate-slide-in ${
          notification.type === 'success' ? 'bg-green-500' :
          notification.type === 'error' ? 'bg-red-500' :
          'bg-blue-500'
        }`}>
          <div className="flex items-center">
            {notification.type === 'success' ? (
              <CheckCircle className="w-5 h-5 mr-2" />
            ) : notification.type === 'error' ? (
              <XCircle className="w-5 h-5 mr-2" />
            ) : (
              <Info className="w-5 h-5 mr-2" />
            )}
            <span className="font-medium">{notification.message}</span>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-cyan-400 hover:text-cyan-300 transition-colors mb-4"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Back to Flight Board</span>
          </button>
          
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-4xl font-bold flex items-center gap-3">
                <Database className="w-10 h-10 text-cyan-400" />
                Flight Backup Dashboard
              </h1>
              <p className="text-gray-400 mt-2">Manage and monitor flight data backups</p>
            </div>
            
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => setRefreshCount(prev => prev + 1)}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 rounded-lg flex items-center gap-2 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
              
              <button
                onClick={handleCreateManualBackup}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg flex items-center gap-2 transition-colors"
              >
                <Download className="w-4 h-4" />
                Create Backup
              </button>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div className="bg-gray-800/50 backdrop-blur-lg rounded-xl p-6 border border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <div className={`w-3 h-3 rounded-full ${getSystemStatusColor(stats.systemStatus)}`}></div>
                <Shield className="w-6 h-6 text-cyan-400" />
              </div>
              <h3 className="text-2xl font-bold">{stats.totalBackups}</h3>
              <p className="text-gray-400">Total Backups</p>
              <div className={`mt-2 text-sm px-2 py-1 rounded-full inline-block ${
                stats.systemStatus === 'healthy' ? 'bg-green-500/20 text-green-400' :
                stats.systemStatus === 'degraded' ? 'bg-yellow-500/20 text-yellow-400' :
                'bg-red-500/20 text-red-400'
              }`}>
                {getSystemStatusText(stats.systemStatus)}
              </div>
            </div>

            <div className="bg-gray-800/50 backdrop-blur-lg rounded-xl p-6 border border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <Calendar className="w-6 h-6 text-green-400" />
              </div>
              <h3 className="text-2xl font-bold">{stats.todayBackups}</h3>
              <p className="text-gray-400">Today&apos;s Backups</p>
              <p className="text-sm text-gray-500 mt-2">
                {formatTimeAgo(stats.latestBackupTime)}
              </p>
            </div>

            <div className="bg-gray-800/50 backdrop-blur-lg rounded-xl p-6 border border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <Plane className="w-6 h-6 text-orange-400" />
              </div>
              <h3 className="text-2xl font-bold">{stats.totalFlights.toLocaleString()}</h3>
              <p className="text-gray-400">Total Flights</p>
              <div className="flex gap-4 mt-2 text-sm">
                <span className="text-green-400">{stats.totalDepartures} departures</span>
                <span className="text-blue-400">{stats.totalArrivals} arrivals</span>
              </div>
            </div>

            <div className="bg-gray-800/50 backdrop-blur-lg rounded-xl p-6 border border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <HardDrive className="w-6 h-6 text-purple-400" />
              </div>
              <h3 className="text-2xl font-bold">Memory</h3>
              <p className="text-gray-400">Storage Type</p>
              <div className="mt-2">
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div 
                    className="bg-cyan-500 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, (backups.length / 50) * 100)}%` }}
                  ></div>
                </div>
                <p className="text-sm text-gray-400 mt-1">
                  {backups.length} / 50 backups ({Math.round((backups.length / 50) * 100)}%)
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Backups List */}
          <div className="lg:col-span-2">
            <div className="bg-gray-800/50 backdrop-blur-lg rounded-xl border border-gray-700 overflow-hidden">
              <div className="p-6 border-b border-gray-700">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <History className="w-6 h-6 text-cyan-400" />
                    <h2 className="text-2xl font-bold">Backup History</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-400">{backups.length} backups</span>
                    {backups.length > 0 && (
                      <button
                        onClick={handleDeleteAllBackups}
                        className="px-3 py-1 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg text-sm flex items-center gap-1 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                        Clear All
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                {backups.length === 0 ? (
                  <div className="p-8 text-center">
                    <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Database className="w-8 h-8 text-gray-600" />
                    </div>
                    <h3 className="text-xl font-semibold mb-2">No Backups Yet</h3>
                    <p className="text-gray-400 mb-4">Create your first backup to get started</p>
                    <button
                      onClick={handleCreateManualBackup}
                      className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 rounded-lg"
                    >
                      Create First Backup
                    </button>
                  </div>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-900/50">
                        <th className="text-left p-4 text-gray-400 font-medium">Timestamp</th>
                        <th className="text-left p-4 text-gray-400 font-medium">Flights</th>
                        <th className="text-left p-4 text-gray-400 font-medium">Type</th>
                        <th className="text-left p-4 text-gray-400 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {backups.map((backup, index) => (
                        <tr 
                          key={backup.id}
                          className={`border-b border-gray-800 ${index % 2 === 0 ? 'bg-gray-900/30' : ''}`}
                        >
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <Clock className="w-4 h-4 text-gray-500" />
                              <div>
                                <div className="font-medium">{formatDateTime(backup.timestamp)}</div>
                                <div className="text-sm text-gray-500">{formatTimeAgo(backup.timestamp)}</div>
                              </div>
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <div className="text-center">
                                <div className="text-xl font-bold">{backup.metadata.totalFlights}</div>
                                <div className="text-xs text-gray-500">total</div>
                              </div>
                              <div className="h-8 w-px bg-gray-700"></div>
                              <div className="text-center">
                                <div className="text-green-400 font-bold">{backup.metadata.departures}</div>
                                <div className="text-xs text-gray-500">departures</div>
                              </div>
                              <div className="text-center">
                                <div className="text-blue-400 font-bold">{backup.metadata.arrivals}</div>
                                <div className="text-xs text-gray-500">arrivals</div>
                              </div>
                            </div>
                          </td>
                          <td className="p-4">
                            {backup.id.includes('emergency') ? (
                              <span className="px-2 py-1 bg-red-500/20 text-red-400 rounded text-xs font-medium">
                                Emergency
                              </span>
                            ) : backup.id.includes('initial') ? (
                              <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs font-medium">
                                Initial
                              </span>
                            ) : (
                              <span className="px-2 py-1 bg-green-500/20 text-green-400 rounded text-xs font-medium">
                                Regular
                              </span>
                            )}
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleDeleteBackup(backup.id)}
                                disabled={deletingBackupId === backup.id}
                                className={`p-2 rounded-lg transition-colors ${
                                  deletingBackupId === backup.id 
                                    ? 'bg-red-700 cursor-not-allowed' 
                                    : 'bg-red-600/20 hover:bg-red-600/30 text-red-400'
                                }`}
                                title="Delete backup"
                              >
                                {deletingBackupId === backup.id ? (
                                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                ) : (
                                  <Trash2 className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>

          {/* Info Panel */}
          <div>
            <div className="bg-gray-800/50 backdrop-blur-lg rounded-xl border border-gray-700 p-6 mb-6">
              <div className="flex items-center gap-3 mb-4">
                <Info className="w-6 h-6 text-cyan-400" />
                <h3 className="text-xl font-bold">Backup System Info</h3>
              </div>
              
              <div className="space-y-4">
                <div className="p-3 bg-gray-900/50 rounded-lg">
                  <div className="text-sm text-gray-400 mb-1">Storage Location</div>
                  <div className="font-medium">Memory (Runtime)</div>
                  <div className="text-xs text-gray-500 mt-1">Backups are stored in memory during runtime</div>
                </div>
                
                <div className="p-3 bg-gray-900/50 rounded-lg">
                  <div className="text-sm text-gray-400 mb-1">Auto Backup</div>
                  <div className="font-medium">Every Successful API Fetch</div>
                  <div className="text-xs text-gray-500 mt-1">Automatically created when live data is fetched</div>
                </div>
                
                <div className="p-3 bg-gray-900/50 rounded-lg">
                  <div className="text-sm text-gray-400 mb-1">Retention Policy</div>
                  <div className="font-medium">Max 50 Backups</div>
                  <div className="text-xs text-gray-500 mt-1">Oldest automatic backup will be deleted when limit is reached</div>
</div>
            <div className="p-3 bg-gray-900/50 rounded-lg">
              <div className="text-sm text-gray-400 mb-1">Emergency Restore</div>
              <div className="font-medium">Automatic on API Failure</div>
              <div className="text-xs text-gray-500 mt-1">System will use latest backup if live data fails</div>
            </div>
          </div>
        </div>
        
        {/* Quick Actions */}
        <div className="bg-gray-800/50 backdrop-blur-lg rounded-xl border border-gray-700 p-6">
          <div className="flex items-center gap-3 mb-4">
            <AlertTriangle className="w-6 h-6 text-yellow-400" />
            <h3 className="text-xl font-bold">System Actions</h3>
          </div>
          
          <div className="space-y-3">
            <button
              onClick={handleCreateManualBackup}
              className="w-full p-3 bg-green-600 hover:bg-green-700 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              <Download className="w-4 h-4" />
              Create Manual Backup
            </button>
            
            <button
              onClick={() => {
                if (backups.length > 0) {
                  showNotification('info', 'Manual restore triggered. System will use backup on next API failure.');
                } else {
                  showNotification('error', 'No backups available to restore from.');
                }
              }}
              disabled={backups.length === 0}
              className={`w-full p-3 rounded-lg flex items-center justify-center gap-2 transition-colors ${
                backups.length === 0 
                  ? 'bg-gray-700 cursor-not-allowed text-gray-400' 
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              <Database className="w-4 h-4" />
              Test Restore Process
            </button>
            
            <button
              onClick={() => {
                // Trigger an emergency backup simulation
                showNotification('info', 'Emergency backup simulation triggered');
              }}
              className="w-full p-3 bg-red-600 hover:bg-red-700 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              <AlertTriangle className="w-4 h-4" />
              Simulate Emergency
            </button>
            
            <button
              onClick={() => {
                // Clear all backups (with confirmation)
                if (backups.length > 0) {
                  handleDeleteAllBackups();
                } else {
                  showNotification('info', 'No backups to clear');
                }
              }}
              className="w-full p-3 bg-gray-700 hover:bg-gray-600 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Clear All Backups
            </button>
          </div>
          
          <div className="mt-6 pt-6 border-t border-gray-700">
            <div className="text-sm text-gray-400 mb-2">System Status</div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  stats?.systemStatus === 'healthy' ? 'bg-green-500 animate-pulse' :
                  stats?.systemStatus === 'degraded' ? 'bg-yellow-500 animate-pulse' :
                  'bg-red-500'
                }`}></div>
                <span className="font-medium">
                  {stats ? getSystemStatusText(stats.systemStatus) : 'Loading...'}
                </span>
              </div>
              <button
                onClick={() => setRefreshCount(prev => prev + 1)}
                className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
              >
                Refresh Status
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    {/* Footer */}
    <div className="mt-8 pt-6 border-t border-gray-800 text-center text-gray-500 text-sm">
      <div className="flex flex-col md:flex-row items-center justify-between">
        <div className="mb-2 md:mb-0">
          <span className="flex items-center justify-center md:justify-start gap-1">
            <Shield className="w-4 h-4" />
            Backup System Active • Auto-refresh every 30 seconds
          </span>
        </div>
        <div>
          Last updated: {new Date().toLocaleTimeString()}
        </div>
      </div>
    </div>
  </div>
  
  <style jsx>{`
    @keyframes slide-in {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
    
    .animate-slide-in {
      animation: slide-in 0.3s ease-out;
    }
  `}</style>
</div>
);
}