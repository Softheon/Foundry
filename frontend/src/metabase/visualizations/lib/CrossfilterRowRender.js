/// Logic for rendering a rows chart.

import d3 from "d3";
import dc from "dc";

import { formatValue } from "metabase/lib/formatting";

import {
  initCrossfilterChart,
  forceSortedGroup,
  makeIndexMap,
} from "./renderer_utils";
import { getFriendlyName } from "./utils";
import { checkXAxisLabelOverlap } from "./LineAreaBarPostRender";

export default function crossfilterRowRenderer(
  element,
  props,
): DeregisterFunction {
  const {
    settings,
    series,
    onHoverChange,
    onVisualizationClick,
    height,
  } = props;
  const { cols } = series[0].data;

  if (series.length > 1) {
    throw new Error("Row chart does not support multiple series");
  }

  const chart = dc.rowChart(element);
  // disable clicks
  const old = chart.onClick;
  chart.onClick = datum => {
    old(datum);
    props.redrawCrossfilterGroup();
  };

  const formatDimension = row =>
    formatValue(row[0], { column: cols[0], type: "axis" });

  // dc.js doesn't give us a way to format the row labels from unformatted data, so we have to
  // do it here then construct a mapping to get the original dimension for tooltipsd/clicks
  // const rows = series[0].data.rows.map(row => [formatDimension(row), row[1]]);
  // const formattedDimensionMap = new Map(
  //   rows.map(([formattedDimension], index) => [
  //     formattedDimension,
  //     series[0].data.rows[index][0],
  //   ]),
  // );

  // const dataset = crossfilter(rows);

  const dimension = props.getDimension();
  const group = props.getGroup();
  const filteredGroups = props.crossfilterData();
  const rows = filteredGroups.map(d => [d.key, d.value]);

  const xDomain = d3.extent(rows, d => d[1]);
  const yValues = rows.map(d => d[0]);

  forceSortedGroup(group, makeIndexMap(yValues));

  initCrossfilterChart(chart, element);

  chart.on("renderlet.tooltips", chart => {
    if (onHoverChange) {
      chart
        .selectAll(".row rect")
        .on("mousemove", (d, i) => {
          onHoverChange &&
            onHoverChange({
              // for single series bar charts, fade the series and highlght the hovered element with CSS
              index: -1,
              event: d3.event,
              data: [
                {
                  key: getFriendlyName(cols[0]),
                  value: d.key,
                  col: cols[0],
                },
                { key: getFriendlyName(cols[1]), value: d.value, col: cols[1] },
              ],
            });
        })
        .on("mouseleave", () => {
          onHoverChange && onHoverChange(null);
        });
    }

    // if (onVisualizationClick) {
    //   chart.selectAll(".row rect").on("click", function(d) {
    //     onVisualizationClick({
    //       value: d.value,
    //       column: cols[1],
    //       dimensions: [
    //         {
    //           value: d.key,
    //           column: cols[0],
    //         },
    //       ],
    //       element: this,
    //     });
    //   });
    // }
  });

  chart
    .ordinalColors([settings.series(series[0]).color])
    .x(d3.scale.linear().domain(xDomain))
    .elasticX(true)
    .dimension(dimension)
    .group(group)
    .ordering(d => d.index);

  let labelPadHorizontal = 5;
  let labelPadVertical = 1;
  let labelsOutside = false;

  // chart.on("renderlet.bar-labels", chart => {
  //   chart
  //     .selectAll("g.row text")
  //     .attr("text-anchor", labelsOutside ? "end" : "start")
  //     .attr("x", labelsOutside ? -labelPadHorizontal : labelPadHorizontal)
  //     .classed(labelsOutside ? "outside" : "inside", true);
  // });

  if (settings["graph.y_axis.labels_enabled"]) {
    chart.on("renderlet.axis-labels", chart => {
      chart
        .svg()
        .append("text")
        .attr("class", "x-axis-label")
        .attr("text-anchor", "middle")
        .attr("x", chart.width() / 2)
        .attr("y", chart.height() - 10)
        .text(settings["graph.y_axis.title_text"]);
    });
  }

  const onResetClick = () => {
    console.log("OnResetClick");
    props.redrawCrossfilterGroup();
  };
  chart.on("renderlet.rest-text", (chart, filter) => {
    if (chart.hasFilter()) {
      chart
        .svg()
        .selectAll("g.reset")
        .remove();
      const x = chart.width() - chart.margins().right;
      const y = chart.margins().top;
      const textSvg = chart
        .svg()
        .append("g")
        .attr("class", "reset")
        .attr("transform", "translate(" + x + "," + y + ")")
        .attr("x", chart.width() - chart.margins().right)
        .attr("y", chart.margins().top)
        .style("cursor", "pointer")
        .on("click", () => {
          chart.filterAll();
          props.redrawCrossfilterGroup();
        });
      textSvg
        .append("text")
        .attr("text-anchor", "middle")
        .text("RESET");
    }
  });

  // initial render
  chart.render();

  // bottom label height
  let axisLabelHeight = 0;
  if (settings["graph.y_axis.labels_enabled"]) {
    axisLabelHeight = chart
      .select(".x-axis-label")
      .node()
      .getBoundingClientRect().height;
    chart.margins().bottom += axisLabelHeight;
  }

  // cap number of rows to fit
  let rects = chart.selectAll(".row rect")[0];
  let containerHeight =
    rects[rects.length - 1].getBoundingClientRect().bottom -
    rects[0].getBoundingClientRect().top;
  let maxTextHeight = Math.max(
    ...chart
      .selectAll("g.row text")[0]
      .map(e => e.getBoundingClientRect().height),
  );
  let rowHeight = maxTextHeight + chart.gap() + labelPadVertical * 2;
  let cap = Math.max(1, Math.floor(containerHeight / rowHeight));
  chart.cap(cap);

  chart.render();

  // check if labels overflow after rendering correct number of rows
  let maxTextWidth = 0;
  for (const elem of chart.selectAll("g.row")[0]) {
    let rect = elem.querySelector("rect").getBoundingClientRect();
    let text = elem.querySelector("text").getBoundingClientRect();
    maxTextWidth = Math.max(maxTextWidth, text.width);
    if (rect.width < text.width + labelPadHorizontal * 2) {
      labelsOutside = true;
    }
  }

  if (labelsOutside) {
    chart.margins().left += maxTextWidth;
    chart.render();
  }

  // hide overlapping x-axis labels
  if (checkXAxisLabelOverlap(chart, ".axis text")) {
    chart.selectAll(".axis").remove();
  }
  const resetFilter = () => {
    chart.filterAll();
  }
  return {
    deregister: () => {
      dc.chartRegistry.deregister(chart);
    },
    redraw: () => {
      chart.redraw()},
    resetFilter,
  };
}
