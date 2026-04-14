import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Papa from 'papaparse';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';
import { 
  Upload, 
  Trophy, 
  Shield, 
  Download, 
  Trash2, 
  LogOut, 
  ChevronRight, 
  FileText, 
  CheckCircle2, 
  AlertCircle,
  Clock,
  User,
  Users
} from 'lucide-react';
import { 
  collection, 
  onSnapshot, 
  query, 
  orderBy, 
  doc, 
  setDoc, 
  addDoc, 
  deleteDoc, 
  getDocs, 
  writeBatch 
} from 'firebase/firestore';
import { db } from './lib/firebase';
import { CSVRow, Submission, GroundTruth, View } from './types';

// --- Constants ---
const ADMIN_ID = 'hackverse@123';
const ADMIN_PASS = 'Hack@1234';

// --- Components ---

const Navbar = ({ currentView, setView, onLogout }: { currentView: View, setView: (v: View) => void, onLogout: () => void }) => (
  <nav className="fixed top-0 left-0 right-0 z-50 px-6 py-4 flex items-center justify-between border-b border-white/5 bg-hack-bg/80 backdrop-blur-md">
    <div className="flex items-center gap-3 cursor-pointer" onClick={() => setView('home')}>
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-hack-cyan to-hack-magenta flex items-center justify-center neon-shadow-cyan">
        <Trophy className="text-white w-6 h-6" />
      </div>
      <div>
        <h1 className="text-xl font-bold tracking-tighter flex items-center gap-1">
          HACKVERSE<span className="text-hack-cyan">PRELIMS</span>
        </h1>
        <p className="text-[10px] font-mono text-white/40 tracking-[0.2em] uppercase">System Online // V2.0</p>
      </div>
    </div>
    
    <div className="flex items-center gap-4">
      {currentView === 'home' ? (
        <button 
          onClick={() => setView('admin-login')}
          className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 hover:border-hack-cyan/50 hover:bg-hack-cyan/5 transition-all text-sm font-medium"
        >
          <Shield className="w-4 h-4 text-hack-cyan" />
          ADMIN PANEL
        </button>
      ) : (
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setView('home')}
            className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 hover:border-hack-cyan/50 hover:bg-hack-cyan/5 transition-all text-sm font-medium"
          >
            <ChevronRight className="w-4 h-4 rotate-180" />
            HOME
          </button>
          {currentView === 'admin-dashboard' && (
            <button 
              onClick={onLogout}
              className="p-2 rounded-full border border-white/10 hover:border-red-500/50 hover:bg-red-500/5 text-red-400 transition-all"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </div>
  </nav>
);

const FileUpload = ({ 
  onFileSelect, 
  accept = ".csv", 
  label = "Drop your CSV here", 
  subLabel = "CSV FILES ONLY",
  className 
}: { 
  onFileSelect: (file: File) => void, 
  accept?: string, 
  label?: string, 
  subLabel?: string,
  className?: string
}) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setIsDragging(true);
    else if (e.type === "dragleave") setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      onFileSelect(e.dataTransfer.files[0]);
    }
  };

  return (
    <div 
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      className={cn(
        "relative group cursor-pointer border-2 border-dashed rounded-2xl transition-all duration-300 flex flex-col items-center justify-center p-8",
        isDragging ? "border-hack-cyan bg-hack-cyan/5" : "border-white/10 hover:border-white/20 bg-white/[0.02]",
        className
      )}
    >
      <input 
        type="file" 
        accept={accept}
        onChange={(e) => e.target.files?.[0] && onFileSelect(e.target.files[0])}
        className="absolute inset-0 opacity-0 cursor-pointer"
      />
      <div className={cn(
        "w-16 h-16 rounded-full flex items-center justify-center mb-4 transition-transform duration-500",
        isDragging ? "scale-110 bg-hack-cyan text-black" : "bg-white/5 text-white/40 group-hover:scale-110 group-hover:bg-white/10 group-hover:text-white"
      )}>
        <Upload className="w-8 h-8" />
      </div>
      <p className="text-lg font-medium text-white/80">{label}</p>
      <p className="text-xs font-mono text-white/40 mt-1 tracking-widest">{subLabel}</p>
    </div>
  );
};

export default function App() {
  const [view, setView] = useState<View>('home');
  const [groundTruth, setGroundTruth] = useState<GroundTruth | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  // --- Persistence ---
  useEffect(() => {
    // 1. Listen for Ground Truth
    const unsubscribeGT = onSnapshot(doc(db, 'config', 'ground_truth'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setGroundTruth({
          records: new Set(data.records),
          totalRows: data.totalRows,
          fileName: data.fileName
        });
      } else {
        setGroundTruth(null);
      }
    });

    // 2. Listen for Submissions (Real-time Leaderboard)
    const q = query(collection(db, 'submissions'), orderBy('timestamp', 'desc'));
    const unsubscribeSubmissions = onSnapshot(q, (snapshot) => {
      const subs: Submission[] = [];
      snapshot.forEach((doc) => {
        subs.push({ id: doc.id, ...doc.data() } as Submission);
      });
      setSubmissions(subs);
    });

    return () => {
      unsubscribeGT();
      unsubscribeSubmissions();
    };
  }, []);

  const handleGroundTruthUpload = async (file: File) => {
    Papa.parse<CSVRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const records = new Set<string>();
        results.data.forEach(row => {
          const key = `${row.date}|${row.team}|${row.time_window}|${row.village}`.toLowerCase().trim();
          records.add(key);
        });

        // Save to Firestore
        await setDoc(doc(db, 'config', 'ground_truth'), {
          records: Array.from(records),
          totalRows: results.data.length,
          fileName: file.name
        });
      }
    });
  };

  const handleUserSubmission = async (teamName: string, captainName: string, file: File) => {
    if (!groundTruth) {
      setSubmitStatus({ type: 'error', message: 'Ground truth dataset not loaded. Contact admin.' });
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus(null);

    Papa.parse<CSVRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        let correctMatches = 0;
        results.data.forEach(row => {
          const key = `${row.date}|${row.team}|${row.time_window}|${row.village}`.toLowerCase().trim();
          if (groundTruth.records.has(key)) {
            correctMatches++;
          }
        });

        const score = (correctMatches / groundTruth.totalRows) * 100;
        const newSubmission = {
          teamName: teamName.trim(),
          captainName: captainName.trim(),
          score: parseFloat(score.toFixed(2)),
          timestamp: Date.now()
        };

        try {
          await addDoc(collection(db, 'submissions'), newSubmission);
          setSubmitStatus({ 
            type: 'success', 
            message: `Submission successful! Score: ${newSubmission.score}%` 
          });
        } catch (err) {
          setSubmitStatus({ type: 'error', message: 'Failed to save submission. Check connection.' });
        }
        setIsSubmitting(false);
      },
      error: (err) => {
        setSubmitStatus({ type: 'error', message: `Parsing error: ${err.message}` });
        setIsSubmitting(false);
      }
    });
  };

  const getLeaderboardData = useMemo(() => {
    const teamBestScores: Record<string, Submission> = {};
    submissions.forEach(sub => {
      const key = sub.teamName.toLowerCase();
      if (!teamBestScores[key] || sub.score > teamBestScores[key].score) {
        teamBestScores[key] = sub;
      }
    });
    return Object.values(teamBestScores).sort((a, b) => b.score - a.score);
  }, [submissions]);

  const downloadCSVs = async () => {
    const zip = new JSZip();

    // File 1: all_submissions.csv
    const allSubmissionsCSV = Papa.unparse(submissions.map(s => ({
      team_name: s.teamName,
      captain_name: s.captainName,
      score: s.score,
      timestamp: new Date(s.timestamp).toISOString()
    })));
    zip.file("all_submissions.csv", allSubmissionsCSV);

    // File 2: leaderboard_top15.csv
    const top15 = getLeaderboardData.slice(0, 15);
    const leaderboardCSV = Papa.unparse(top15.map((s, i) => ({
      rank: i + 1,
      team_name: s.teamName,
      score: s.score
    })));
    zip.file("leaderboard_top15.csv", leaderboardCSV);

    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, "hackverse_results.zip");
  };

  const handleLogout = () => {
    setView('home');
  };

  return (
    <div className="min-h-screen pt-24 pb-12 px-6 max-w-7xl mx-auto">
      <Navbar currentView={view} setView={setView} onLogout={handleLogout} />

      <AnimatePresence mode="wait">
        {view === 'home' && (
          <motion.div 
            key="home"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="grid lg:grid-cols-2 gap-12 items-start"
          >
            {/* Left: Hero & Info */}
            <div className="space-y-8">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-hack-cyan/10 border border-hack-cyan/20 text-hack-cyan text-xs font-bold tracking-wider uppercase">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-hack-cyan opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-hack-cyan"></span>
                  </span>
                  Live Evaluation System
                </div>
                <h2 className="text-7xl font-bold tracking-tighter leading-[0.9]">
                  PUSH YOUR <br />
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-hack-cyan via-hack-magenta to-hack-cyan bg-[length:200%_auto] animate-gradient-x">LIMITS</span>
                </h2>
                <p className="text-lg text-white/60 max-w-md">
                  Submit your dataset and claim your spot on the leaderboard. 
                  Precision is the only currency that matters here.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="glass p-6 rounded-3xl space-y-2">
                  <Users className="w-6 h-6 text-hack-cyan" />
                  <div className="text-2xl font-bold">{getLeaderboardData.length}</div>
                  <div className="text-xs text-white/40 uppercase tracking-widest">Active Teams</div>
                </div>
                <div className="glass p-6 rounded-3xl space-y-2">
                  <Clock className="w-6 h-6 text-hack-magenta" />
                  <div className="text-2xl font-bold">{submissions.length}</div>
                  <div className="text-xs text-white/40 uppercase tracking-widest">Total Attempts</div>
                </div>
              </div>
            </div>

            {/* Right: Submission Portal */}
            <div className="glass p-8 rounded-[2.5rem] relative overflow-hidden neon-shadow-cyan">
              <div className="absolute top-0 right-0 w-32 h-32 bg-hack-cyan/10 blur-3xl rounded-full -mr-16 -mt-16"></div>
              
              <div className="flex items-center gap-3 mb-8">
                <Upload className="w-6 h-6 text-hack-cyan" />
                <h3 className="text-2xl font-bold italic uppercase tracking-tight">Submission Portal</h3>
              </div>

              <SubmissionForm 
                onSubmit={handleUserSubmission} 
                isSubmitting={isSubmitting} 
                status={submitStatus}
              />
            </div>

            {/* Bottom: Leaderboard */}
            <div className="lg:col-span-2 mt-12">
              <div className="flex flex-col items-center mb-12">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-hack-magenta/30 bg-hack-magenta/5 text-hack-magenta text-xs font-bold uppercase tracking-widest mb-4">
                  <Trophy className="w-3 h-3" />
                  Global Rankings
                </div>
                <h2 className="text-5xl font-bold italic tracking-tighter uppercase text-center">
                  Hall of <span className="text-hack-cyan">Legends</span>
                </h2>
                <div className="w-24 h-1 bg-gradient-to-r from-hack-cyan to-hack-magenta mt-4 rounded-full"></div>
              </div>

              <div className="glass rounded-[2rem] overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/5 bg-white/[0.02]">
                      <th className="px-8 py-6 text-[10px] font-bold uppercase tracking-[0.3em] text-white/40">Rank</th>
                      <th className="px-8 py-6 text-[10px] font-bold uppercase tracking-[0.3em] text-white/40">Team Identity</th>
                      <th className="px-8 py-6 text-[10px] font-bold uppercase tracking-[0.3em] text-white/40 text-center">Accuracy Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {getLeaderboardData.slice(0, 15).map((sub, i) => (
                      <motion.tr 
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}
                        key={sub.id} 
                        className="group hover:bg-white/[0.03] transition-colors border-b border-white/5 last:border-0"
                      >
                        <td className="px-8 py-6">
                          <div className={cn(
                            "w-8 h-8 rounded-lg flex items-center justify-center font-mono font-bold text-sm",
                            i === 0 ? "bg-hack-cyan text-black neon-shadow-cyan" : 
                            i === 1 ? "bg-white/20 text-white" :
                            i === 2 ? "bg-white/10 text-white/80" : "text-white/40"
                          )}>
                            {i + 1}
                          </div>
                        </td>
                        <td className="px-8 py-6">
                          <div>
                            <div className="font-bold text-lg group-hover:text-hack-cyan transition-colors">{sub.teamName}</div>
                            <div className="text-xs text-white/40 flex items-center gap-1 mt-1">
                              <User className="w-3 h-3" />
                              {sub.captainName}
                            </div>
                          </div>
                        </td>
                        <td className="px-8 py-6 text-center">
                          <div className="inline-block px-4 py-2 rounded-xl bg-white/5 font-mono text-xl font-bold text-hack-cyan">
                            {sub.score}%
                          </div>
                        </td>
                      </motion.tr>
                    ))}
                    {getLeaderboardData.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-8 py-24 text-center">
                          <div className="flex flex-col items-center gap-4 opacity-20">
                            <FileText className="w-12 h-12" />
                            <p className="font-mono text-sm tracking-[0.2em] uppercase">Waiting for incoming data...</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}

        {view === 'admin-login' && (
          <motion.div 
            key="login"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="max-w-md mx-auto mt-20"
          >
            <div className="glass p-10 rounded-[2.5rem] neon-shadow-magenta">
              <div className="flex flex-col items-center text-center mb-8">
                <div className="w-16 h-16 rounded-2xl bg-hack-magenta/10 flex items-center justify-center mb-4 border border-hack-magenta/20">
                  <Shield className="w-8 h-8 text-hack-magenta" />
                </div>
                <h2 className="text-3xl font-bold italic uppercase tracking-tight">Access Restricted</h2>
                <p className="text-sm text-white/40 uppercase tracking-widest mt-2">Enter Admin Credentials</p>
              </div>

              <AdminLoginForm onLoginSuccess={() => setView('admin-dashboard')} />
            </div>
          </motion.div>
        )}

        {view === 'admin-dashboard' && (
          <motion.div 
            key="admin"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-8"
          >
            <div className="glass p-8 rounded-[2.5rem] border-hack-cyan/20">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-hack-cyan/10 flex items-center justify-center border border-hack-cyan/20">
                    <Shield className="w-6 h-6 text-hack-cyan" />
                  </div>
                  <div>
                    <h2 className="text-3xl font-bold italic uppercase tracking-tight">Command Center</h2>
                    <p className="text-xs font-mono text-white/40 tracking-[0.2em] uppercase">System Overrides // Authorized Personnel Only</p>
                  </div>
                </div>
                <button 
                  onClick={handleLogout}
                  className="text-xs font-bold text-white/40 hover:text-white transition-colors uppercase tracking-widest"
                >
                  Logout
                </button>
              </div>

              <div className="grid md:grid-cols-2 gap-8">
                {/* Ground Truth Section */}
                <div className="space-y-6">
                  <div className="flex items-center gap-2 text-white/60">
                    <FileText className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-widest">Ground Truth Dataset</span>
                  </div>
                  
                  <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-white/40 uppercase font-bold">Status</span>
                      {groundTruth ? (
                        <div className="flex items-center gap-2 text-hack-green text-xs font-bold uppercase">
                          <CheckCircle2 className="w-3 h-3" />
                          Loaded
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-red-400 text-xs font-bold uppercase">
                          <AlertCircle className="w-3 h-3" />
                          Not Loaded
                        </div>
                      )}
                    </div>
                    {groundTruth && (
                      <div className="space-y-1">
                        <div className="text-sm font-bold truncate">{groundTruth.fileName}</div>
                        <div className="text-[10px] font-mono text-white/40 uppercase tracking-wider">
                          {groundTruth.records.size} Records // {groundTruth.totalRows} Total Rows
                        </div>
                      </div>
                    )}
                    <FileUpload 
                      onFileSelect={handleGroundTruthUpload} 
                      label={groundTruth ? "Update Dataset" : "Upload Master CSV"}
                      className="py-12"
                    />
                  </div>
                </div>

                {/* Actions Section */}
                <div className="space-y-6">
                  <div className="flex items-center gap-2 text-white/60">
                    <AlertCircle className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-widest">Danger Zone</span>
                  </div>

                  <div className="p-6 rounded-2xl bg-red-500/5 border border-red-500/10 space-y-6">
                    <p className="text-xs text-red-200/60 leading-relaxed">
                      Wipe all submission data and reset rankings to zero. This action is irreversible.
                    </p>
                    <button 
                      onClick={async () => {
                        if (confirm('Are you absolutely sure? This will delete all submissions from the database.')) {
                          const querySnapshot = await getDocs(collection(db, 'submissions'));
                          const batch = writeBatch(db);
                          querySnapshot.forEach((d) => {
                            batch.delete(d.ref);
                          });
                          await batch.commit();
                        }
                      }}
                      className="w-full py-4 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 font-bold italic uppercase tracking-widest text-sm border border-red-500/20 transition-all"
                    >
                      Factory Reset
                    </button>
                  </div>

                  <button 
                    onClick={downloadCSVs}
                    disabled={submissions.length === 0}
                    className="w-full py-6 rounded-2xl bg-hack-cyan text-black font-bold italic uppercase tracking-[0.2em] flex items-center justify-center gap-3 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:hover:scale-100 neon-shadow-cyan"
                  >
                    <Download className="w-5 h-5" />
                    Export Results (.ZIP)
                  </button>
                </div>
              </div>
            </div>

            {/* Submissions Table */}
            <div className="glass rounded-[2.5rem] overflow-hidden">
              <div className="px-8 py-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                <h3 className="text-xl font-bold italic uppercase tracking-tight">Recent Submissions</h3>
                <div className="px-3 py-1 rounded-full bg-white/5 text-[10px] font-mono text-white/60 uppercase tracking-widest">
                  {submissions.length} Total
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-white/[0.01]">
                      <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-white/40">Team</th>
                      <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-white/40">Captain</th>
                      <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-white/40">Score</th>
                      <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-white/40">Timestamp</th>
                      <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-white/40 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {submissions.slice().reverse().map((sub) => (
                      <tr key={sub.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors">
                        <td className="px-8 py-4 font-bold">{sub.teamName}</td>
                        <td className="px-8 py-4 text-white/60">{sub.captainName}</td>
                        <td className="px-8 py-4">
                          <span className="text-hack-cyan font-mono font-bold">{sub.score}%</span>
                        </td>
                        <td className="px-8 py-4 text-xs text-white/40 font-mono">
                          {new Date(sub.timestamp).toLocaleString()}
                        </td>
                        <td className="px-8 py-4 text-right">
                          <button 
                            onClick={async () => {
                              if (confirm('Delete this submission?')) {
                                await deleteDoc(doc(db, 'submissions', sub.id));
                              }
                            }}
                            className="p-2 rounded-lg hover:bg-red-500/10 text-white/20 hover:text-red-400 transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {submissions.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-8 py-12 text-center text-white/20 italic text-sm">
                          No submissions recorded yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const SubmissionForm = ({ 
  onSubmit, 
  isSubmitting, 
  status 
}: { 
  onSubmit: (team: string, captain: string, file: File) => void, 
  isSubmitting: boolean,
  status: { type: 'success' | 'error', message: string } | null
}) => {
  const [teamName, setTeamName] = useState('');
  const [captainName, setCaptainName] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (teamName && captainName && file) {
      onSubmit(teamName, captainName, file);
    }
  };

  // Reset form on success status change
  useEffect(() => {
    if (status?.type === 'success') {
      setTeamName('');
      setCaptainName('');
      setFile(null);
    }
  }, [status]);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-1">Team Name</label>
          <input 
            required
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="e.g. ALPHA_CORE"
            className="w-full px-5 py-4 rounded-2xl bg-white/5 border border-white/10 focus:border-hack-cyan/50 focus:bg-hack-cyan/5 outline-none transition-all font-medium placeholder:text-white/10"
          />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-1">Team Captain</label>
          <input 
            required
            value={captainName}
            onChange={(e) => setCaptainName(e.target.value)}
            placeholder="e.g. Sarah Connor"
            className="w-full px-5 py-4 rounded-2xl bg-white/5 border border-white/10 focus:border-hack-cyan/50 focus:bg-hack-cyan/5 outline-none transition-all font-medium placeholder:text-white/10"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-1">Solution File (.CSV)</label>
        {file ? (
          <div className="p-6 rounded-2xl bg-hack-cyan/5 border border-hack-cyan/20 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-hack-cyan/10 flex items-center justify-center text-hack-cyan">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-bold truncate max-w-[200px]">{file.name}</div>
                <div className="text-[10px] font-mono text-hack-cyan/60 uppercase">Ready for evaluation</div>
              </div>
            </div>
            <button 
              type="button"
              onClick={() => setFile(null)}
              className="p-2 rounded-lg hover:bg-red-500/10 text-white/20 hover:text-red-400 transition-all"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <FileUpload onFileSelect={setFile} className="py-12" />
        )}
      </div>

      <AnimatePresence>
        {status && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className={cn(
              "p-4 rounded-xl flex items-center gap-3 text-sm font-medium",
              status.type === 'success' ? "bg-hack-green/10 text-hack-green border border-hack-green/20" : "bg-red-500/10 text-red-400 border border-red-500/20"
            )}
          >
            {status.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {status.message}
          </motion.div>
        )}
      </AnimatePresence>

      <button 
        type="submit"
        disabled={isSubmitting || !file || !teamName || !captainName}
        className="w-full py-6 rounded-2xl bg-hack-cyan text-black font-bold italic uppercase tracking-[0.2em] flex items-center justify-center gap-3 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:hover:scale-100 neon-shadow-cyan"
      >
        {isSubmitting ? (
          <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin"></div>
        ) : (
          <>
            <ChevronRight className="w-5 h-5" />
            Submit for Evaluation
          </>
        )}
      </button>
    </form>
  );
};

const AdminLoginForm = ({ onLoginSuccess }: { onLoginSuccess: () => void }) => {
  const [id, setId] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (id === ADMIN_ID && pass === ADMIN_PASS) {
      onLoginSuccess();
    } else {
      setError('Invalid credentials. Authorization denied.');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <label className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-1">Admin ID</label>
        <input 
          required
          value={id}
          onChange={(e) => setId(e.target.value)}
          className="w-full px-5 py-4 rounded-2xl bg-white/5 border border-white/10 focus:border-hack-magenta/50 focus:bg-hack-magenta/5 outline-none transition-all font-medium"
        />
      </div>
      <div className="space-y-2">
        <label className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-1">Password</label>
        <input 
          required
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          className="w-full px-5 py-4 rounded-2xl bg-white/5 border border-white/10 focus:border-hack-magenta/50 focus:bg-hack-magenta/5 outline-none transition-all font-medium"
        />
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 text-sm font-medium flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      <button 
        type="submit"
        className="w-full py-6 rounded-2xl bg-hack-magenta text-white font-bold italic uppercase tracking-[0.2em] flex items-center justify-center gap-3 hover:scale-[1.02] active:scale-[0.98] transition-all neon-shadow-magenta"
      >
        Authorize Access
      </button>
    </form>
  );
};
