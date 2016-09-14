/* @flow */
'use strict'

import React from 'react'

import {
  SegmentedControlIOS,
  View
} from 'react-native'

import colors from '../../colors'

class Filter extends React.Component {
  render() {
    return (
      <View style={styles.container}>
        <SegmentedControlIOS
          values={['Replies', 'All']}
          tintColor={colors.grayUI}
          style={styles.segmentedControl}
          selectedIndex={this.props.selectedIndex}
          onChange={(event) => {
            this.props.onChange(event.nativeEvent.selectedSegmentIndex)
          }}
        />
      </View>
    )
  }
}

const styles = {
  container: {
    backgroundColor: 'white',
    flex:1
  },
  segmentedControl: {
    margin: 12
  }
}

export default Filter
