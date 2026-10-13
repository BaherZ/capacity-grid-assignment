import { dateValue, fullDate, shiftDate, shortDate } from "./capacity";

type Props = { from: string; to: string };

export function CapacityLoading({ from, to }: Props) {
  const weekCount =
    Math.floor((dateValue(to) - dateValue(from)) / (7 * 86_400_000)) + 1;
  const weeks = Array.from({ length: weekCount }, (_, index) => {
    const start = shiftDate(from, index * 7);
    return { start, end: shiftDate(start, 6) };
  });

  return (
    <div
      className="table-scroll"
      role="region"
      aria-label={`Capacity for ${fullDate(from)} through ${fullDate(to)} is loading. Scroll horizontally for more weeks.`}
      aria-busy="true"
      tabIndex={0}
    >
      <table className="capacity-table capacity-skeleton">
        <caption className="sr-only">
          Selected weeks from {fullDate(from)} through {fullDate(to)}. People
          and allocation values are not yet available.
        </caption>
        <thead>
          <tr>
            <th className="person-column" scope="col">
              <span>TEAM MEMBER</span>
              <small>Weekly capacity</small>
            </th>
            {weeks.map((week) => (
              <th scope="col" key={week.start}>
                <span className="week-header">
                  {shortDate(week.start)} <span>– {shortDate(week.end)}</span>
                </span>
                <small>
                  {week.start.slice(0, 4)}
                  {week.end.slice(0, 4) !== week.start.slice(0, 4)
                    ? ` / ${week.end.slice(0, 4)}`
                    : ""}
                </small>
              </th>
            ))}
          </tr>
        </thead>
        <tbody aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <tr key={index}>
              <th className="person-column" scope="row">
                <div className="person-cell">
                  <span className="avatar skeleton-avatar" />
                  <div className="skeleton-person">
                    <span className="skeleton-block skeleton-name" />
                    <span className="skeleton-block skeleton-capacity" />
                  </div>
                </div>
              </th>
              {weeks.map((week) => (
                <td key={week.start}>
                  <div className="allocation-value">
                    <span className="skeleton-block skeleton-hours" />
                  </div>
                  <div className="allocation-bar skeleton-bar" />
                  <span className="allocation-note">
                    <span className="skeleton-block skeleton-note" />
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
