export interface CSVRow {
  date: string;
  team: string;
  time_window: string;
  village: string;
}

export interface Submission {
  id: string;
  teamName: string;
  captainName: string;
  score: number;
  timestamp: number;
}

export interface GroundTruth {
  records: Set<string>;
  totalRows: number;
  fileName: string;
}

export type View = 'home' | 'admin-login' | 'admin-dashboard';
