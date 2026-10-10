# YaaraLabs Frontend API Integration Setup

This document explains how to set up and use the API integration between the frontend and backend.

## Environment Configuration

Create a `.env.local` file in the frontend directory with the following variables:

```bash
# Backend API URL (change this to match your backend)
NEXT_PUBLIC_API_URL=http://localhost:8080

# Alternative backend URLs for different environments
# NEXT_PUBLIC_API_URL=http://127.0.0.1:8080
# NEXT_PUBLIC_API_URL=http://localhost:8080

# Scratch Editor Configuration
NEXT_PUBLIC_SCRATCH_EDITOR_URL=http://localhost:8601
NEXT_PUBLIC_SCRATCH_VM_URL=http://localhost:8602
```

## API Service Usage

### 1. Basic API Service

The `api-service.ts` file provides a comprehensive service for all backend operations:

```typescript
import { apiService } from '../lib/api-service';

// Create a new project
const response = await apiService.createProject({
  name: 'My ML Project',
  description: 'A text classification project',
  type: 'text-recognition'
});

// Get all projects
const projects = await apiService.getProjects();

// Start training
const training = await apiService.startTraining('project123', {
  epochs: 100,
  batch_size: 32,
  learning_rate: 0.001
});
```

### 2. React Hooks

Use the custom hooks for React components:

```typescript
import { useProjects, useCreateProject } from '../lib/use-api';

function MyComponent() {
  const projects = useProjects();
  const createProject = useCreateProject();

  useEffect(() => {
    projects.execute(); // Load projects
  }, []);

  const handleCreate = async () => {
    await createProject.execute({
      name: 'New Project',
      description: 'Description'
    });
    projects.execute(); // Reload projects
  };

  return (
    <div>
      {projects.loading && <div>Loading...</div>}
      {projects.error && <div>Error: {projects.error}</div>}
      {projects.data?.map(project => (
        <div key={project.id}>{project.name}</div>
      ))}
    </div>
  );
}
```

### 3. Available Hooks

- `useProjects()` - Get all projects
- `useProject(projectId)` - Get specific project
- `useCreateProject()` - Create new project
- `useUpdateProject()` - Update existing project
- `useDeleteProject()` - Delete project
- `useTraining()` - Start training
- `useTrainingStatus(projectId)` - Get training status
- `useFileUpload()` - Upload training data
- `useTeachers()` - Get teachers
- `useStudents()` - Get students
- `useClassrooms()` - Get classrooms
- `useDemoProjects()` - Get demo projects

## Guest Projects API

### 1. Guest Project Management

The guest projects API allows users without accounts to create and manage ML projects. **Important**: This API uses the correct HTTP methods:

- **GET** `/api/guests/session/{sessionId}/projects/{projectId}` - Retrieve a project
- **POST** `/api/guests/session/{sessionId}/projects` - Create a new project
- **PUT** `/api/guests/session/{sessionId}/projects/{projectId}` - Update a project
- **DELETE** `/api/guests/session/{sessionId}/projects/{projectId}` - Delete a project

```typescript
import { 
    useGuestProjects, 
    useGuestProject,
    useCreateGuestProject,
    useGuestTraining,
    useGuestPrediction 
} from '../lib/use-api';

function GuestComponent({ sessionId }: { sessionId: string }) {
    const guestProjects = useGuestProjects(sessionId);
    const createProject = useCreateGuestProject();
    
    useEffect(() => {
        guestProjects.execute(); // Load guest projects using GET method
    }, [sessionId]);
    
    const handleCreate = async () => {
        await createProject.execute(sessionId, {
            name: 'My Guest Project',
            description: 'A text classification project',
            type: 'text'
        });
        guestProjects.execute(); // Reload projects
    };
}
```

### 2. Available Guest Project Hooks

- `useGuestProjects(sessionId)` - Get all guest projects for a session (GET)
- `useGuestProject(sessionId, projectId)` - Get specific guest project (GET)
- `useCreateGuestProject()` - Create new guest project (POST)
- `useUpdateGuestProject()` - Update existing guest project (PUT)
- `useDeleteGuestProject()` - Delete guest project (DELETE)
- `useGuestTraining()` - Start training for guest project (POST)
- `useGuestTrainingStatus(sessionId, projectId)` - Get training status (GET)
- `useGuestPrediction()` - Get predictions from guest project (POST)
- `useUploadGuestExamples()` - Upload training examples (POST)

### 3. HTTP Method Summary

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Get all projects | GET | `/api/guests/session/{sessionId}/projects` |
| Get project | GET | `/api/guests/session/{sessionId}/projects/{projectId}` |
| Create project | POST | `/api/guests/session/{sessionId}/projects` |
| Update project | PUT | `/api/guests/session/{sessionId}/projects/{projectId}` |
| Delete project | DELETE | `/api/guests/session/{sessionId}/projects/{projectId}` |
| Start training | POST | `/api/guests/session/{sessionId}/projects/{projectId}/train` |
| Get training status | GET | `/api/guests/session/{sessionId}/projects/{projectId}/train` |
| Make prediction | POST | `/api/guests/session/{sessionId}/projects/{projectId}/predict` |
| Upload examples | POST | `/api/guests/session/{sessionId}/projects/{projectId}/examples` |

## Scratch Editor Integration

### 1. Extension Setup

The Scratch extension (`neural-api-extension.js`) provides blocks for:

- Creating ML projects
- Starting training
- Getting predictions
- Uploading training data
- Monitoring training status

### 2. Using the Extension

1. Load the extension in Scratch
2. Use the new blocks in the "YaaraLabs API" category
3. Configure the API URL in the extension file
4. Test with simple projects first

### 3. Extension Blocks

- `create project [name] with description [description]`
- `start training project [projectId] with [epochs] epochs`
- `get training status of project [projectId]`
- `get prediction for [input] using project [projectId]`
- `upload training data [data] to project [projectId]`
- `get all projects`
- `get demo projects with category [category]`

## Error Handling

All API calls include proper error handling:

```typescript
const response = await apiService.createProject(data);

if (response.success) {
  // Handle success
  console.log('Project created:', response.data);
} else {
  // Handle error
  console.error('Error:', response.error);
  console.error('Details:', response.details);
}
```

## CORS Configuration

The backend is configured to allow requests from:
- `http://localhost:3000` (Next.js dev server)
- `http://localhost:8601` (Scratch editor)
- `http://127.0.0.1:3000` (Loopback)
- `http://127.0.0.1:8080` (Backend API Loopback)
- `http://127.0.0.1:8601` (Scratch Editor Loopback)
- `http://127.0.0.1:8602` (Scratch VM Loopback)
- `*` (All origins during development)

## Testing the Integration

1. Start your backend server on port 8080
2. Start your frontend on port 3000
3. Test API calls using the ProjectManager component
4. Verify CORS is working correctly
5. Test Scratch extension integration

## Troubleshooting

### Common Issues

1. **CORS Errors**: Ensure backend CORS is configured correctly
2. **API URL Mismatch**: Check `NEXT_PUBLIC_API_URL` in `.env.local`
3. **Network Errors**: Verify backend is running and accessible
4. **Authentication**: Some endpoints may require user authentication

### Debug Steps

1. Check browser console for errors
2. Verify backend logs for incoming requests
3. Test API endpoints directly with tools like Postman
4. Check network tab in browser dev tools

## Security Notes

- In production, restrict CORS origins to specific domains
- Implement proper authentication and authorization
- Validate all input data on both frontend and backend
- Use HTTPS in production environments
- Consider rate limiting for API endpoints
