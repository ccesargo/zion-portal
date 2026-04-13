import React from "https://esm.sh/react@18";
import ReactDOM from "https://esm.sh/react-dom@18/client";
import App from "./ZionPortal.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  React.createElement(React.StrictMode, null, React.createElement(App))
);
