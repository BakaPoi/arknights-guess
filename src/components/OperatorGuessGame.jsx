import React, { useState, useEffect } from "react";
import "../styles/base.css";
import "../styles/layout.css";
import "../styles/form.css";
import "../styles/table.css";
import "../styles/popup.css";
import "../styles/theme-dark.css";
import operators from "./operators.json";

function compareEnum(a, b) {
  return a === b ? "green" : "red";
}

function compareNumber(a, b) {
  if (a === b) return "green";
  return a < b ? "up" : "down"; // lower rarity/date → 🔺 (older)
}

function compareClass(guess, target) {
  if (guess.archetype === target.archetype) return "green";
  if (guess.class === target.class) return "orange";
  return "red";
}

function compareDateField(guess, target) {
  const g = new Date(guess.release.date_global);
  const t = new Date(target.release.date_global);
  if (isNaN(g) || isNaN(t)) return "red";
  if (g.getTime() === t.getTime()) return "green";
  if (g.getTime() < t.getTime()) return "up";
  return "down";
}

function compareOperators(guess, target) {
  const dateStatus = compareDateField(guess, target);
  const dateLabel = `${guess.release.date_global} (${guess.release.event_name || "Unknown Event"})`;

  return {
    name: guess.name,
    gender: { value: guess.gender, status: compareEnum(guess.gender, target.gender) },
    rarity: { value: guess.rarity, status: compareNumber(guess.rarity, target.rarity) },
    class_archetype: { value: `${guess.class} / ${guess.archetype}`, status: compareClass(guess, target) },
    faction: { value: guess.faction, status: compareEnum(guess.faction, target.faction) },
    race: { value: guess.race, status: compareEnum(guess.race, target.race) },
    region: { value: guess.region, status: compareEnum(guess.region, target.region) },
    release_date: { value: dateLabel, status: dateStatus },
  };
}

const getColorClass = (status) => {
  switch (status) {
    case "green": return "cell-green";
    case "red": return "cell-red";
    case "orange": return "cell-orange";
    case "up":
    case "down": return "cell-gray";
    default: return "";
  }
};

const formatValue = (field) => {
  switch (field.status) {
    case "green": return `✅ ${field.value}`;
    case "red": return `❌ ${field.value}`;
    case "orange": return `🟧 ${field.value}`;
    case "up": return `🔺 ${field.value}`;
    case "down": return `🔻 ${field.value}`;
    default: return field.value;
  }
};

// 🎯 Select the daily operator (reset at 4:00 UTC-7 → 11:00 UTC)
function getDailyOperator(offsetDays = 0) {
  const now = new Date();
  const utcHour = now.getUTCHours();
  if (utcHour < 11) now.setUTCDate(now.getUTCDate() - 1);

  now.setUTCDate(now.getUTCDate() - offsetDays);
  const daySeed = Math.floor(now.getTime() / (1000 * 60 * 60 * 24));
  const index = daySeed % operators.length;
  return operators[index];
}

export default function OperatorGuessGame() {
  const todayTarget = getDailyOperator();
  const yesterdayTarget = getDailyOperator(1);

  const localKey = `guesses_${todayTarget.name}`;
  const saved = localStorage.getItem(localKey);
  const initialGuesses = saved ? JSON.parse(saved) : [];
  const alreadyWon = initialGuesses.some(g => g.name === getDailyOperator().name);
  const [hasWon, setHasWon] = useState(alreadyWon);

  const [target, setTarget] = useState(todayTarget);
  const [guesses, setGuesses] = useState(initialGuesses);
  const [input, setInput] = useState("");
  const [showWin, setShowWin] = useState(false);
  const [filteredList, setFilteredList] = useState([]);
  const [staleData, setStaleData] = useState(false);
  const [timeLeft, setTimeLeft] = useState("");

  const [darkMode, setDarkMode] = useState(() => {
    // Sauvegarde du thème entre les sessions
    return localStorage.getItem("darkMode") === "true";
  });

  useEffect(() => {
    document.body.classList.toggle("dark-theme", darkMode);
    localStorage.setItem("darkMode", darkMode);
  }, [darkMode]);

  // 🕓 compute countdown and day-change check
  useEffect(() => {
    function getNextReset() {
      const now = new Date();
      const nextReset = new Date(now);
      nextReset.setUTCHours(11, 0, 0, 0); // 4:00 UTC-7 = 11:00 UTC
      if (now.getUTCHours() >= 11) nextReset.setUTCDate(nextReset.getUTCDate() + 1);
      return nextReset;
    }

    function updateCountdown() {
      const now = new Date();
      const nextReset = getNextReset();
      const diffMs = nextReset - now;

      if (diffMs <= 0) {
        setStaleData(true);
        setTimeLeft("00h 00m");
        return;
      }

      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      setTimeLeft(`${hours.toString().padStart(2, "0")}h ${minutes.toString().padStart(2, "0")}m`);
    }

    function checkDayChange() {
      const currentTarget = getDailyOperator();
      if (currentTarget.name !== target.name) {
        setStaleData(true);
      }
    }

    updateCountdown();
    const countdownInterval = setInterval(updateCountdown, 60000); // update every minute
    const dayCheckInterval = setInterval(checkDayChange, 10 * 60 * 1000); // every 10 min

    return () => {
      clearInterval(countdownInterval);
      clearInterval(dayCheckInterval);
    };
  }, [target]);

  useEffect(() => {
    if (guesses.some((g) => g.name === target.name)) {
      setShowWin(true);
      setHasWon(true);
      localStorage.setItem(`won_${target.name}`, "true");
    }
  }, [guesses, target]);


  useEffect(() => {
    localStorage.setItem(localKey, JSON.stringify(guesses));
  }, [guesses, localKey]);

  useEffect(() => {
    const filtered = operators.filter(
      (op) =>
        op.name.toLowerCase().startsWith(input.toLowerCase()) &&
        !guesses.some((g) => g.name === op.name)
    );
    setFilteredList(filtered);
  }, [input, guesses]);

  const handleSubmit = (e, selectedOperator) => {
    e.preventDefault();
    const guess =
      selectedOperator ||
      operators.find((op) => op.name.toLowerCase() === input.toLowerCase());
    if (hasWon) return alert("🎉 You’ve already found today’s operator!");
    if (!guess) return alert("Unknown operator!");
    const feedback = compareOperators(guess, target);
    feedback.image = guess.image;
    setGuesses([...guesses, feedback]);
    setInput("");
  };

  return (
    <div className="game-container">
      <header className="header">
        <h1>Arknights Daily Guess</h1>
        <div className="theme-switch">
          <label className="switch">
            <input
              type="checkbox"
              checked={darkMode}
              onChange={() => setDarkMode(!darkMode)}
            />
            <span className="slider"></span>
          </label>
          <span>{darkMode ? "Dark" : "Light"} Mode</span>
        </div>
      </header>
      <p className="subtitle">Try to guess today's operator! (Resets daily at 4:00 UTC-7)</p>

      {/* ⚠️ Banner when a new day starts */}
      {staleData && (
        <div className="stale-banner">
          <p>⚠️ A new daily operator is available!</p>
          <button className="refresh-btn" onClick={() => window.location.reload()}>
            🔄 Refresh now
          </button>
        </div>
      )}

      {/* Countdown always visible */}
      <p className="countdown">Next reset in: {timeLeft}</p>

      <div className="yesterday-info">
        Yesterday: {yesterdayTarget.name}
        <img src={`${process.env.PUBLIC_URL}/${yesterdayTarget.image.portrait}`} alt={yesterdayTarget.name} className="yesterday-img" />
      </div>

      <form onSubmit={handleSubmit} className="guess-form">
        <div className="input-wrapper">
          <input
            className="guess-input"
            placeholder="Enter an operator (e.g., Texas)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={hasWon}
          />
          {input && filteredList.length > 0 && (
            <ul className="autocomplete-list">
              {filteredList.map((op, i) => (
                <li
                  key={i}
                  onClick={() => handleSubmit(new Event("submit"), op)}
                  className="autocomplete-item"
                >
                  <img src={`${process.env.PUBLIC_URL}/${op.image.portrait}`} alt={op.name} className="autocomplete-icon" />
                  {op.name}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button className="submit-btn" disabled={hasWon}>
          Submit
        </button>
        <p className="attempts">Number of attempts: {guesses.length}</p>
      </form>
      
      {hasWon && (
        <p className="already-won-msg">🎯 You’ve already found today’s Operator. Come back tomorrow!</p>
      )}

      <table className="guess-table">
        <thead>
          <tr>
            <th>Portrait</th>
            <th>Name</th>
            <th>Gender</th>
            <th>Rarity</th>
            <th>Class / Archetype</th>
            <th>Faction</th>
            <th>Race</th>
            <th>Region</th>
            <th>Release Date</th>
          </tr>
        </thead>
        <tbody>
          {guesses.map((g, i) => (
            <tr key={i}>
              <td><img src={`${process.env.PUBLIC_URL}/${g.image?.portrait}`} alt={g.name} className="portrait" /></td>
              <td>{g.name}</td>
              <td className={getColorClass(g.gender.status)}>{formatValue(g.gender)}</td>
              <td className={getColorClass(g.rarity.status)}>{formatValue(g.rarity)}</td>
              <td className={getColorClass(g.class_archetype.status)}>{formatValue(g.class_archetype)}</td>
              <td className={getColorClass(g.faction.status)}>{formatValue(g.faction)}</td>
              <td className={getColorClass(g.race.status)}>{formatValue(g.race)}</td>
              <td className={getColorClass(g.region.status)}>{formatValue(g.region)}</td>
              <td className={getColorClass(g.release_date.status)}>{formatValue(g.release_date)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {showWin && (
        <div className="win-overlay">
          <div className="win-popup">
            <h2>🎉 You found today's Operator!</h2>
            <p className="win-name">{target.name}</p>
            <img src={`${process.env.PUBLIC_URL}/${target.image.full}`} alt={target.name} className="win-image" />
            <button onClick={() => setShowWin(false)} className="win-button">OK</button>
          </div>
        </div>
      )}
    </div>
  );
}
