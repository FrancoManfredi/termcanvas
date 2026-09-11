import React from "react";
import { createRoot } from "react-dom/client";
import { FactoryLabPage } from "./features/factoryLab/FactoryLabPage";
import "./index.css";
const root = document.getElementById('root')!;
createRoot(root).render(React.createElement(FactoryLabPage));
