import { useState, useCallback } from 'react';
import { 
  apiService, 
  ApiResponse, 
  Project, 
  TrainingConfig, 
  PredictionInput, 
  TrainingExampleInput,
  TrainingStatus,
  PredictionResult
} from './api-service';

interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

interface UseApiReturn<T> extends UseApiState<T> {
  execute: (...args: unknown[]) => Promise<void>;
  reset: () => void;
}

export function useApi<T = unknown>(
  apiMethod: (...args: unknown[]) => Promise<ApiResponse<T>>,
  initialData: T | null = null
): UseApiReturn<T> {
  const [state, setState] = useState<UseApiState<T>>({
    data: initialData,
    loading: false,
    error: null,
  });

  const execute = useCallback(
    async (...args: unknown[]) => {
      setState(prev => ({ ...prev, loading: true, error: null }));
      
      try {
        const response = await apiMethod(...args);
        
        if (response.success) {
          setState({
            data: response.data || null,
            loading: false,
            error: null,
          });
        } else {
          setState({
            data: null,
            loading: false,
            error: response.error || 'Unknown error occurred',
          });
        }
      } catch (error) {
        setState({
          data: null,
          loading: false,
          error: error instanceof Error ? error.message : 'Unknown error occurred',
        });
      }
    },
    [apiMethod]
  );

  const reset = useCallback(() => {
    setState({
      data: initialData,
      loading: false,
      error: null,
    });
  }, [initialData]);

  return {
    ...state,
    execute,
    reset,
  };
}

// Specific hooks for common operations
export function useProjects(userId?: string) {
  return useApi(
    ((id?: string) => apiService.getProjects(id || userId)) as (...args: unknown[]) => Promise<ApiResponse<Project[]>>,
    []
  );
}

export function useProject(projectId: string) {
  return useApi(
    (() => apiService.getProject(projectId)) as (...args: unknown[]) => Promise<ApiResponse<Project>>,
    null
  );
}

export function useCreateProject() {
  return useApi(
    ((projectData: Partial<Project>) => apiService.createProject(projectData)) as (...args: unknown[]) => Promise<ApiResponse<Project>>,
    null
  );
}

export function useUpdateProject() {
  return useApi(
    ((projectId: string, projectData: Partial<Project>) => apiService.updateProject(projectId, projectData)) as (...args: unknown[]) => Promise<ApiResponse<Project>>,
    null
  );
}

export function useDeleteProject() {
  return useApi(
    ((projectId: string) => apiService.deleteProject(projectId)) as (...args: unknown[]) => Promise<ApiResponse<unknown>>,
    null
  );
}

export function useTeachers() {
  return useApi(
    (() => apiService.getTeachers()) as (...args: unknown[]) => Promise<ApiResponse<unknown[]>>,
    []
  );
}

export function useStudents(teacherId?: string, classroomId?: string) {
  return useApi(
    ((tId?: string, cId?: string) => apiService.getStudents(tId || teacherId, cId || classroomId)) as (...args: unknown[]) => Promise<ApiResponse<unknown[]>>,
    []
  );
}

export function useClassrooms(teacherId?: string) {
  return useApi(
    ((id?: string) => apiService.getClassrooms(id || teacherId)) as (...args: unknown[]) => Promise<ApiResponse<unknown[]>>,
    []
  );
}

export function useDemoProjects(category?: string, difficulty?: string) {
  return useApi(
    ((cat?: string, diff?: string) => apiService.getDemoProjects(cat || category, diff || difficulty)) as (...args: unknown[]) => Promise<ApiResponse<unknown[]>>,
    []
  );
}

export function useTraining() {
  return useApi(
    ((projectId: string, config: TrainingConfig) => apiService.startTraining(projectId, config)) as (...args: unknown[]) => Promise<ApiResponse<unknown>>,
    null
  );
}

export function useTrainingStatus(projectId: string) {
  return useApi(
    (() => apiService.getTrainingStatus(projectId)) as (...args: unknown[]) => Promise<ApiResponse<TrainingStatus>>,
    null
  );
}

export function useFileUpload() {
  return useApi(
    ((projectId: string, file: File) => apiService.uploadTrainingData(projectId, file)) as (...args: unknown[]) => Promise<ApiResponse<unknown>>,
    null
  );
}

// Guest Project Hooks
export function useGuestProjects(sessionId: string, limit?: number, offset?: number, status?: string, type?: string, search?: string) {
  return useApi(
    ((sId?: string, l?: number, o?: number, s?: string, t?: string, srch?: string) => 
      apiService.getGuestProjects(sId || sessionId, l || limit, o || offset, s || status, t || type, srch || search)) as (...args: unknown[]) => Promise<ApiResponse<Project[]>>,
    []
  );
}

export function useGuestProject(sessionId: string, projectId: string) {
  return useApi(
    (() => apiService.getGuestProject(sessionId, projectId)) as (...args: unknown[]) => Promise<ApiResponse<Project>>,
    null
  );
}

export function useCreateGuestProject() {
  return useApi(
    ((sessionId: string, projectData: Partial<Project>) => apiService.createGuestProject(sessionId, projectData)) as (...args: unknown[]) => Promise<ApiResponse<Project>>,
    null
  );
}

export function useUpdateGuestProject() {
  return useApi(
    ((sessionId: string, projectId: string, projectData: Partial<Project>) => apiService.updateGuestProject(sessionId, projectId, projectData)) as (...args: unknown[]) => Promise<ApiResponse<Project>>,
    null
  );
}

export function useDeleteGuestProject() {
  return useApi(
    ((sessionId: string, projectId: string) => apiService.deleteGuestProject(sessionId, projectId)) as (...args: unknown[]) => Promise<ApiResponse<unknown>>,
    null
  );
}

export function useGuestTraining() {
  return useApi(
    ((sessionId: string, projectId: string, config: TrainingConfig) => apiService.startGuestTraining(sessionId, projectId, config)) as (...args: unknown[]) => Promise<ApiResponse<unknown>>,
    null
  );
}

export function useGuestTrainingStatus(sessionId: string, projectId: string) {
  return useApi(
    (() => apiService.getGuestTrainingStatus(sessionId, projectId)) as (...args: unknown[]) => Promise<ApiResponse<TrainingStatus>>,
    null
  );
}

export function useGuestPrediction() {
  return useApi(
    ((sessionId: string, projectId: string, input: PredictionInput) => apiService.getGuestPrediction(sessionId, projectId, input)) as (...args: unknown[]) => Promise<ApiResponse<PredictionResult>>,
    null
  );
}

export function useUploadGuestExamples() {
  return useApi(
    ((sessionId: string, projectId: string, examples: TrainingExampleInput[]) => apiService.uploadGuestExamples(sessionId, projectId, examples)) as (...args: unknown[]) => Promise<ApiResponse<unknown>>,
    null
  );
}
