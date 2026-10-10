
// API Service for YaaraLabs Playground
// Handles all API calls to the backend

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://yaaralabs-playground-backend-uaaur7no2a-uc.a.run.app';

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  details?: string[];
}

interface Project {
  id: string;
  name: string;
  description?: string;
  createdBy: string;  // Changed from user_id to createdBy to match backend
  teacher_id: string;  // Added to match backend
  classroom_id: string;  // Added to match backend
  student_id: string;  // Added to match backend
  createdAt: string;  // Changed from created_at to createdAt
  updatedAt: string;  // Changed from updated_at to updatedAt
  status: string;
  type?: string;  // Changed from model_type to type
  teachable_machine_link?: string;  // Changed from teachable_link to teachable_machine_link
  training_data?: TrainingData;
}

interface TrainingData {
  examples?: TrainingExample[];
  labels?: string[];
  model?: ModelInfo;
}

interface TrainingExample {
  text: string;
  label: string;
  created_at?: string;
}

interface ModelInfo {
  labels: string[];
  accuracy?: number;
  status?: string;
}

interface ScratchService {
  id: string;
  name: string;
  description?: string;
  endpoint: string;
  created_at: string;
}

interface GuestSession {
  session_id: string;
  created_at: string;
  expires_at: string;
  active: boolean;
  ip_address?: string;
  user_agent?: string;
}

interface TrainingConfig {
  epochs: number;
  batch_size: number;
  learning_rate: number;
  validation_split?: number;
}

interface TrainingStatus {
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress?: number;
  accuracy?: number;
  loss?: number;
  current_epoch?: number;
  total_epochs?: number;
}

interface PredictionInput {
  text: string;
}

interface PredictionResult {
  label: string;
  confidence: number;
  alternatives?: Array<{ label: string; confidence: number }>;
}

interface TrainingExampleInput {
  text: string;
  label: string;
}

interface Teacher {
  id: string;
  name: string;
  email: string;
  school?: string;
  created_at: string;
}

interface Student {
  id: string;
  name: string;
  email: string;
  teacher_id?: string;
  classroom_id?: string;
  created_at: string;
}

interface Classroom {
  id: string;
  name: string;
  teacher_id: string;
  description?: string;
  created_at: string;
  students?: Student[];
}

interface DemoProject {
  id: string;
  name: string;
  description: string;
  category: string;
  difficulty: string;
  instructions: string;
  created_at: string;
}

class ApiService {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    try {
      const url = `${this.baseUrl}${endpoint}`;
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        ...options,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('API request failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Health Check
  async healthCheck(): Promise<ApiResponse> {
    return this.request('/health');
  }

  // Projects API
  async getProjects(userId?: string): Promise<ApiResponse<Project[]>> {
    const endpoint = userId ? `/projects?user_id=${userId}` : '/projects';
    return this.request<Project[]>(endpoint);
  }

  async getProject(projectId: string): Promise<ApiResponse<Project>> {
    return this.request<Project>(`/projects/${projectId}`);
  }

  async createProject(projectData: Partial<Project>): Promise<ApiResponse<Project>> {
    return this.request<Project>('/projects', {
      method: 'POST',
      body: JSON.stringify(projectData),
    });
  }

  async updateProject(projectId: string, projectData: Partial<Project>): Promise<ApiResponse<Project>> {
    return this.request<Project>(`/projects/${projectId}`, {
      method: 'PUT',
      body: JSON.stringify(projectData),
    });
  }

  async deleteProject(projectId: string): Promise<ApiResponse> {
    return this.request(`/projects/${projectId}`, {
      method: 'DELETE',
    });
  }

  // Teachers API
  async getTeachers(): Promise<ApiResponse<Teacher[]>> {
    return this.request<Teacher[]>('/teachers');
  }

  async getTeacher(teacherId: string): Promise<ApiResponse<Teacher>> {
    return this.request<Teacher>(`/teachers/${teacherId}`);
  }

  async createTeacher(teacherData: Partial<Teacher>): Promise<ApiResponse<Teacher>> {
    return this.request<Teacher>('/teachers', {
      method: 'POST',
      body: JSON.stringify(teacherData),
    });
  }

  async updateTeacher(teacherId: string, teacherData: Partial<Teacher>): Promise<ApiResponse<Teacher>> {
    return this.request<Teacher>(`/teachers/${teacherId}`, {
      method: 'PUT',
      body: JSON.stringify(teacherData),
    });
  }

  async deleteTeacher(teacherId: string): Promise<ApiResponse> {
    return this.request(`/teachers/${teacherId}`, {
      method: 'DELETE',
    });
  }

  // Students API
  async getStudents(teacherId?: string, classroomId?: string): Promise<ApiResponse<Student[]>> {
    let endpoint = '/students';
    const params = new URLSearchParams();
    if (teacherId) params.append('teacher_id', teacherId);
    if (classroomId) params.append('classroom_id', classroomId);
    if (params.toString()) endpoint += `?${params.toString()}`;
    
    return this.request<Student[]>(endpoint);
  }

  async getStudent(studentId: string): Promise<ApiResponse<Student>> {
    return this.request<Student>(`/students/${studentId}`);
  }

  async createStudent(studentData: Partial<Student>): Promise<ApiResponse<Student>> {
    return this.request<Student>('/students', {
      method: 'POST',
      body: JSON.stringify(studentData),
    });
  }

  async updateStudent(studentId: string, studentData: Partial<Student>): Promise<ApiResponse<Student>> {
    return this.request<Student>(`/students/${studentId}`, {
      method: 'PUT',
      body: JSON.stringify(studentData),
    });
  }

  async deleteStudent(studentId: string): Promise<ApiResponse> {
    return this.request(`/students/${studentId}`, {
      method: 'DELETE',
    });
  }

  // Classrooms API
  async getClassrooms(teacherId?: string): Promise<ApiResponse<Classroom[]>> {
    const endpoint = teacherId ? `/classrooms?teacher_id=${teacherId}` : '/classrooms';
    return this.request<Classroom[]>(endpoint);
  }

  async getClassroom(classroomId: string): Promise<ApiResponse<Classroom>> {
    return this.request<Classroom>(`/classrooms/${classroomId}`);
  }

  async createClassroom(classroomData: Partial<Classroom>): Promise<ApiResponse<Classroom>> {
    return this.request<Classroom>('/classrooms', {
      method: 'POST',
      body: JSON.stringify(classroomData),
    });
  }

  async updateClassroom(classroomId: string, classroomData: Partial<Classroom>): Promise<ApiResponse<Classroom>> {
    return this.request<Classroom>(`/classrooms/${classroomId}`, {
      method: 'PUT',
      body: JSON.stringify(classroomData),
    });
  }

  async deleteClassroom(classroomId: string): Promise<ApiResponse> {
    return this.request(`/classrooms/${classroomId}`, {
      method: 'DELETE',
    });
  }

  // Demo Projects API
  async getDemoProjects(category?: string, difficulty?: string): Promise<ApiResponse<DemoProject[]>> {
    let endpoint = '/demo-projects';
    const params = new URLSearchParams();
    if (category) params.append('category', category);
    if (difficulty) params.append('difficulty', difficulty);
    if (params.toString()) endpoint += `?${params.toString()}`;
    
    return this.request<DemoProject[]>(endpoint);
  }

  async getDemoProject(projectId: string): Promise<ApiResponse<DemoProject>> {
    return this.request<DemoProject>(`/demo-projects/${projectId}`);
  }

  // Scratch Services API
  async getScratchServices(): Promise<ApiResponse<ScratchService[]>> {
    return this.request<ScratchService[]>('/scratch-services');
  }

  async createScratchService(serviceData: Partial<ScratchService>): Promise<ApiResponse<ScratchService>> {
    return this.request<ScratchService>('/scratch-services', {
      method: 'POST',
      body: JSON.stringify(serviceData),
    });
  }

  // Guest API
  async createGuestSession(guestData: Partial<GuestSession>): Promise<ApiResponse<GuestSession>> {
    return this.request<GuestSession>('/api/guests/session', {
      method: 'POST',
      body: JSON.stringify(guestData),
    });
  }

  // Guest Projects API
  async getGuestProjects(sessionId: string, limit?: number, offset?: number, status?: string, type?: string, search?: string): Promise<ApiResponse<Project[]>> {
    let endpoint = `/api/guests/session/${sessionId}/projects`;
    const params = new URLSearchParams();
    if (limit) params.append('limit', limit.toString());
    if (offset) params.append('offset', offset.toString());
    if (status) params.append('status', status);
    if (type) params.append('type', type);
    if (search) params.append('search', search);
    if (params.toString()) endpoint += `?${params.toString()}`;
    
    return this.request<Project[]>(endpoint);
  }

  async getGuestProject(sessionId: string, projectId: string): Promise<ApiResponse<Project>> {
    return this.request<Project>(`/api/guests/session/${sessionId}/projects/${projectId}`);
  }

  async createGuestProject(sessionId: string, projectData: Partial<Project>): Promise<ApiResponse<Project>> {
    return this.request<Project>(`/api/guests/session/${sessionId}/projects`, {
      method: 'POST',
      body: JSON.stringify(projectData),
    });
  }

  async updateGuestProject(sessionId: string, projectId: string, projectData: Partial<Project>): Promise<ApiResponse<Project>> {
    return this.request<Project>(`/api/guests/session/${sessionId}/projects/${projectId}`, {
      method: 'PUT',
      body: JSON.stringify(projectData),
    });
  }

  async deleteGuestProject(sessionId: string, projectId: string): Promise<ApiResponse> {
    return this.request(`/api/guests/session/${sessionId}/projects/${projectId}`, {
      method: 'DELETE',
    });
  }

  // Guest Project Training
  async startGuestTraining(sessionId: string, projectId: string, trainingConfig: TrainingConfig): Promise<ApiResponse<TrainingStatus>> {
    return this.request<TrainingStatus>(`/api/guests/session/${sessionId}/projects/${projectId}/train`, {
      method: 'POST',
      body: JSON.stringify(trainingConfig),
    });
  }

  async getGuestTrainingStatus(sessionId: string, projectId: string): Promise<ApiResponse<TrainingStatus>> {
    return this.request<TrainingStatus>(`/api/guests/session/${sessionId}/projects/${projectId}/train`);
  }

  async getGuestPrediction(sessionId: string, projectId: string, input: PredictionInput): Promise<ApiResponse<PredictionResult>> {
    return this.request<PredictionResult>(`/api/guests/session/${sessionId}/projects/${projectId}/predict`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async uploadGuestExamples(sessionId: string, projectId: string, examples: TrainingExampleInput[]): Promise<ApiResponse<{ success: boolean; count: number }>> {
    return this.request<{ success: boolean; count: number }>(`/api/guests/session/${sessionId}/projects/${projectId}/examples`, {
      method: 'POST',
      body: JSON.stringify(examples),
    });
  }

  // Training API
  async startTraining(projectId: string, trainingConfig: TrainingConfig): Promise<ApiResponse<TrainingStatus>> {
    return this.request<TrainingStatus>(`/projects/${projectId}/train`, {
      method: 'POST',
      body: JSON.stringify(trainingConfig),
    });
  }

  async getTrainingStatus(projectId: string): Promise<ApiResponse<TrainingStatus>> {
    return this.request<TrainingStatus>(`/projects/${projectId}/training-status`);
  }

  async stopTraining(projectId: string): Promise<ApiResponse> {
    return this.request(`/projects/${projectId}/stop-training`, {
      method: 'POST',
    });
  }

  // File Upload API
  async uploadTrainingData(projectId: string, file: File): Promise<ApiResponse<{ filename: string; size: number; records: number }>> {
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const response = await fetch(`${this.baseUrl}/projects/${projectId}/upload`, {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('File upload failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

// Create and export a singleton instance
export const apiService = new ApiService();

// Export the class for custom instances
export default ApiService;

// Export types for use in components
export type {
  ApiResponse,
  Project,
  Teacher,
  Student,
  Classroom,
  DemoProject,
  TrainingData,
  TrainingExample,
  ModelInfo,
  ScratchService,
  GuestSession,
  TrainingConfig,
  TrainingStatus,
  PredictionInput,
  PredictionResult,
  TrainingExampleInput,
};
