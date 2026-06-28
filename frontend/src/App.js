import "@/App.css";
import { Planner } from "@/components/Planner";
import { Toaster } from "@/components/ui/sonner";

function App() {
  return (
    <div className="App">
      <Planner />
      <Toaster position="top-right" />
    </div>
  );
}

export default App;
