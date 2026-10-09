from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
import subprocess
import os
import signal
import psutil
import asyncio
from typing import Dict, Optional
import logging
from ..config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/scratch", tags=["scratch-services"])

# Store running processes
scratch_processes: Dict[str, subprocess.Popen] = {}

class ScratchServiceManager:
    def __init__(self):
        self.gui_process: Optional[subprocess.Popen] = None
        self.vm_process: Optional[subprocess.Popen] = None
        self.gui_port = 8601  # Default scratch-gui port
        self.vm_port = 8602   # Default scratch-vm port
        
    def start_gui_service(self) -> bool:
        """Start scratch-gui service using npm start"""
        try:
            if self.gui_process and self.gui_process.poll() is None:
                logger.info("Scratch GUI service is already running")
                return True
                
            # Path to scratch-gui package
            scratch_gui_path = os.path.join(
                os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                "scratch-editor",
                "packages",
                "scratch-gui"
            )
            
            logger.info(f"Checking path: {scratch_gui_path}")
            if not os.path.exists(scratch_gui_path):
                raise Exception(f"Scratch GUI path not found: {scratch_gui_path}")
            
            # Check if package.json exists
            package_json_path = os.path.join(scratch_gui_path, "package.json")
            if not os.path.exists(package_json_path):
                raise Exception(f"package.json not found in: {scratch_gui_path}")
            
            # Check if node_modules exists
            node_modules_path = os.path.join(scratch_gui_path, "node_modules")
            if not os.path.exists(node_modules_path):
                logger.warning(f"node_modules not found in: {scratch_gui_path}")
                logger.warning("This might cause npm start to fail")
            
            logger.info(f"Starting scratch-gui service from: {scratch_gui_path}")
            
            # Start the service with more detailed error capture
            self.gui_process = subprocess.Popen(
                ["npm", "start"],
                cwd=scratch_gui_path,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=dict(os.environ, PORT=str(self.gui_port))
            )
            
            # Store the process
            scratch_processes["scratch-gui"] = self.gui_process
            
            logger.info(f"Scratch GUI service started with PID: {self.gui_process.pid}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to start scratch-gui service: {e}")
            logger.error(f"Exception type: {type(e).__name__}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return False
    
    def start_vm_service(self) -> bool:
        """Start scratch-vm service using npm start"""
        try:
            if self.vm_process and self.vm_process.poll() is None:
                logger.info("Scratch VM service is already running")
                return True
                
            # Path to scratch-vm package
            scratch_vm_path = os.path.join(
                os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                "scratch-editor",
                "packages",
                "scratch-vm"
            )
            
            if not os.path.exists(scratch_vm_path):
                raise Exception(f"Scratch VM path not found: {scratch_vm_path}")
            
            logger.info(f"Starting scratch-vm service from: {scratch_vm_path}")
            
            # Start the service
            self.vm_process = subprocess.Popen(
                ["npm", "start"],
                cwd=scratch_vm_path,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            
            # Store the process
            scratch_processes["scratch-vm"] = self.vm_process
            
            logger.info(f"Scratch VM service started with PID: {self.vm_process.pid}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to start scratch-vm service: {e}")
            return False
    
    def stop_all_services(self):
        """Stop all running Scratch services"""
        try:
            if self.gui_process:
                self.gui_process.terminate()
                logger.info("Scratch GUI service stopped")
                
            if self.vm_process:
                self.vm_process.terminate()
                logger.info("Scratch VM service stopped")
                
            # Clean up stored processes
            for name, process in scratch_processes.items():
                if process and process.poll() is None:
                    process.terminate()
                    logger.info(f"Stopped {name} service")
                    
            scratch_processes.clear()
            
        except Exception as e:
            logger.error(f"Error stopping services: {e}")
    
    def get_service_status(self) -> Dict[str, any]:
        """Get status of all Scratch services"""
        return {
            "gui": {
                "running": self.gui_process and self.gui_process.poll() is None,
                "pid": self.gui_process.pid if self.gui_process else None,
                "port": self.gui_port
            },
            "vm": {
                "running": self.vm_process and self.vm_process.poll() is None,
                "pid": self.vm_process.pid if self.vm_process else None,
                "port": self.vm_port
            }
        }

# Global service manager
service_manager = ScratchServiceManager()

@router.post("/start-gui")
async def start_gui_service(background_tasks: BackgroundTasks):
    """Start the scratch-gui service"""
    try:
        success = service_manager.start_gui_service()
        
        if success:
            # Wait a bit for the service to start
            await asyncio.sleep(2)
            
            return {
                "success": True,
                "message": "Scratch GUI service started successfully",
                "status": service_manager.get_service_status()
            }
        else:
            raise Exception("Failed to start scratch-gui service")
            
    except Exception as e:
        logger.error(f"Error starting GUI service: {e}")
        import traceback
        logger.error(f"Full traceback: {traceback.format_exc()}")
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(e),
                "traceback": traceback.format_exc()
            }
        )

@router.post("/start-vm")
async def start_vm_service(background_tasks: BackgroundTasks):
    """Start the scratch-vm service"""
    try:
        success = service_manager.start_vm_service()
        
        if success:
            # Wait a bit for the service to start
            await asyncio.sleep(2)
            
            return {
                "success": True,
                "message": "Scratch VM service started successfully",
                "status": service_manager.get_service_status()
            }
        else:
            raise Exception("Failed to start scratch-vm service")
            
    except Exception as e:
        logger.error(f"Error starting VM service: {e}")
        import traceback
        logger.error(f"Full traceback: {traceback.format_exc()}")
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(e),
                "traceback": traceback.format_exc()
            }
        )

@router.post("/start-all")
async def start_all_services(background_tasks: BackgroundTasks):
    """Start both scratch-gui and scratch-vm services"""
    try:
        logger.info("Starting all Scratch services...")
        
        # Start GUI service
        gui_success = service_manager.start_gui_service()
        if not gui_success:
            raise Exception("Failed to start scratch-gui service")
        
        # Wait a bit between starts
        await asyncio.sleep(3)
        
        # Start VM service
        vm_success = service_manager.start_vm_service()
        if not vm_success:
            raise Exception("Failed to start scratch-vm service")
        
        # Wait for services to be ready
        await asyncio.sleep(5)
        
        status = service_manager.get_service_status()
        
        # Use production URL in production, localhost in development
        from ..config import settings
        gui_url = "http://localhost:8601" if settings.node_env == "development" else settings.scratch_editor_url
        vm_url = "http://localhost:8602" if settings.node_env == "development" else settings.scratch_editor_url
        
        return {
            "success": True,
            "message": "All Scratch services started successfully",
            "status": status,
            "gui_url": gui_url,
            "vm_url": vm_url
        }
        
    except Exception as e:
        logger.error(f"Error starting all services: {e}")
        import traceback
        logger.error(f"Full traceback: {traceback.format_exc()}")
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(e),
                "traceback": traceback.format_exc()
            }
        )

@router.get("/status")
async def get_services_status():
    """Get status of all Scratch services"""
    try:
        status = service_manager.get_service_status()
        
        return {
            "success": True,
            "status": status,
            "all_running": all([
                status["gui"]["running"],
                status["vm"]["running"]
            ])
        }
        
    except Exception as e:
        logger.error(f"Error getting service status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/stop-all")
async def stop_all_services():
    """Stop all running Scratch services"""
    try:
        service_manager.stop_all_services()
        
        return {
            "success": True,
            "message": "All Scratch services stopped successfully"
        }
        
    except Exception as e:
        logger.error(f"Error stopping services: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/health")
async def health_check():
    """Health check for Scratch services"""
    try:
        status = service_manager.get_service_status()
        all_running = all([
            status["gui"]["running"],
            status["vm"]["running"]
        ])
        
        return {
            "healthy": all_running,
            "services": status,
            "message": "All services running" if all_running else "Some services not running"
        }
        
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return {
            "healthy": False,
            "error": str(e)
        }
