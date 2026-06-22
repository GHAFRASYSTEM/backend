// DB row shape (mirror Supabase table)
export interface UserInterviewContextRow {
  user_id:         string;
  personal_info:   string | null;
  cv_text:         string | null;
  job_description: string | null;
  company_info:    string | null;
  notes:           string | null;
  updated_at:      string;
}

// POST /interview/context
export interface UpsertContextBody {
  personalInfo?:   string;
  cvText?:         string;
  jobDescription?: string;
  companyInfo?:    string;
  notes?:          string;
}

export interface UpsertContextResponse {
  status:  'success';
  message: string;
}

// GET /interview/context
export interface GetContextResponse {
  userId:          string;
  personalInfo:    string | null;
  cvText:          string | null;
  jobDescription:  string | null;
  companyInfo:     string | null;
  notes:           string | null;
}

// POST /interview/respond
export interface RespondBody {
  text: string;
}

export interface RespondResponse {
  answer:     string;
  isQuestion: boolean;
}

export interface TranscribeResponse {
  text: string;
}