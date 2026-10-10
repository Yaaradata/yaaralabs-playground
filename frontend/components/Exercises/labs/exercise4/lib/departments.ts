import type { DepartmentInfo } from "./types";

export const DRIVE_ROOT = "https://drive.google.com/drive/folders/1kv8UqLoTEc62nE0_7DUGDOy1uo932xXS";

export const DEPARTMENTS: DepartmentInfo[] = [
  { id: "civil", code: "CIVIL", name: "Civil Engineering", color: "mag", drive: "1VKx_crJ0M9mkst-V1P5CNTJckd6h9xTp", data: "Road pavement survey patches", classes: "Pothole, Crack, Clean asphalt, Road shoulder", sampleClasses: ["Pothole", "Crack", "Clean asphalt"] },
  { id: "mech", code: "MECH", name: "Mechanical Engineering", color: "lime", drive: "1YLYhT6ZWcY-Hcf3VSioDkZxw2tuo5Pcv", data: "NEU hot-rolled steel surface defects", classes: "Crazing, Inclusion, Patches, Pitted surface, Rolled-in scale, Scratches", sampleClasses: ["Crazing", "Inclusion", "Patches"] },
  { id: "eee", code: "EEE", name: "Electrical Engineering", color: "cyan", drive: "1lltKdOE9cEXIu4fftwF_wYwBJ2L5UTvd", data: "ELPV solar-cell electroluminescence images", classes: "Mono / Poly × working / defective", sampleClasses: ["Mono working", "Mono defective", "Poly working"] },
  { id: "ece", code: "ECE", name: "Electronics and Communication", color: "blue", drive: "1O4IjfGre_JHtXFHV2FHS4kK_2OlDYwox", data: "DeepPCB circuit-board defects", classes: "Open circuit, Short, Mouse bite, Spur, Spurious copper, Pin hole", sampleClasses: ["Open circuit", "Short", "Mouse bite"] },
  { id: "cse", code: "CSE", name: "Computer Science", color: "mag", drive: "1m3hVCtQyzvguFWDV9U3r7UKLpe6Bt-HD", data: "CIFAR-10 everyday photos", classes: "Airplane, Automobile, Bird, Cat, Deer, Dog, Frog, Horse, Ship, Truck", sampleClasses: ["Airplane", "Cat", "Dog"] },
  { id: "it", code: "IT", name: "Information Technology", color: "gold", drive: "1T1arD2WbDgHQL0h86YmQeDSgar40jBvu", data: "Sign Language MNIST hand shapes", classes: "Letters A to K (no J)", sampleClasses: ["A", "B", "C"] },
  { id: "chem", code: "CHEM", name: "Chemical Engineering", color: "amber", drive: "1IPD9KL8u7dLM796rDTFb6IyDNcHHOWf3", data: "MixedWM38 semiconductor wafer maps", classes: "Centre, Donut, Edge local, Edge ring, Local, Scratch, Random, No defect", sampleClasses: ["Centre", "Donut", "Scratch"] },
  { id: "aero", code: "AERO", name: "Aerospace Engineering", color: "green", drive: "1zO8o6k1EuNYzpFuDRbpQ0hbxbR_vBOs0", data: "MSTAR airborne radar targets", classes: "10 ground vehicles seen by SAR", sampleClasses: ["BMP2", "T72", "ZSU23"] },
  { id: "automobile", code: "AUTOMOBILE", name: "Automobile Engineering", color: "mag", drive: "1973nNuokVXTqgXKJBuKngYraValv8JUh", data: "GTSRB traffic signs", classes: "Speed limits 30–80, Stop, Give way, No entry and more", sampleClasses: ["Stop", "Speed 30", "No entry"] },
  { id: "bme", code: "BME", name: "Biomedical Engineering", color: "cyan", drive: "1TrNPd1jicX38ttYu0ANjvPXRJqJPqW3f", data: "BloodMNIST blood-cell microscopy", classes: "Basophil, Eosinophil, Erythroblast and 5 more", sampleClasses: ["Basophil", "Lymphocyte", "Neutrophil"] },
];

export function findDept(id: string | null): DepartmentInfo | null {
  return DEPARTMENTS.find((item) => item.id === id) ?? null;
}
