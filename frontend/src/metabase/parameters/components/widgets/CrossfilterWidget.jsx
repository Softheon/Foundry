import React, { Component } from "react";
import { t, ngettext, msgid } from "c-3po";
import CrossfilterDimensionPicker from "../../../query_builder/components/filters/pickers/CrossfilterDimensionPicker.jsx";

import SelectPicker from "../../../query_builder/components/filters/pickers/SelectPicker.jsx";

export default class CrossfilterWidget extends Component {
  constructor(props) {
    super(props);
    this.state = {
      selectedValues: Array.isArray(props.value)
        ? props.value
        : props.value ? [props.value] : [],
    };
  }
  static format(values, fieldValues) {
    if (Array.isArray(values)) {
      const n = values.length;
      return ngettext(msgid`${n} selection`, `${n} selections`, n);
    } else {
      return "Select one or more dimensions for this crossfilter";
    }
  }

  getOptions() {
    return this.props.values.slice().map(value => {
      return {
        name: value[0],
        key: value[0],
      };
    });
  }

  commitValues = (values: ?Array<string>) => {
    if (values && values.length === 0) {
      values = null;
    }
    this.props.setValue(values);
    this.props.onClose();
  };

  resetValues = () => {
    this.setState({ selectedValues: [] });
  };


  onSelectedValuesChange = (values: Array<string>) => {
    this.setState({ selectedValues: values });
  };


  render() {
    const options = this.getOptions();
    const selectedValues = this.state.selectedValues;
    
    return (
      <div style={{ minWidth: 182 }}>
        <CrossfilterDimensionPicker
          options={options}
          values={(selectedValues: Array<string>)}
          onValuesChange={this.onSelectedValuesChange}
          multi={true}
        />
        <div className="p1">
          <button
            data-ui-tag="reset-crossfilter"
            className="Button Button--purple full"
            onClick={() => this.resetValues()}
          >
            {t`Reset`}
          </button>

          <button
            data-ui-tag="complete-crossfilter"
            className="Button Button--purple full mt1"
            onClick={() => this.commitValues(this.state.selectedValues)}
          >
            {t`Done`}
          </button>
        </div>
      </div>
    );
  }
}